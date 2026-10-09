import React, { useRef, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ExportBar, SimLayout, CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Atmospheric pressure: P(h) = P0 exp(-h/H), H = RT/(Mg) scale height.
// Layers: troposphere, stratosphere, mesosphere, thermosphere.
const schema = [
  { key: 'T0', label: 'Sea-level T (K)', min: 200, max: 320, step: 1, type: 'range' },
  { key: 'M', label: 'Molar mass M (g/mol)', min: 20, max: 44, step: 0.1, type: 'range' },
  { key: 'hMax', label: 'Max altitude (km)', min: 20, max: 200, step: 5, type: 'range' },
  { key: 'lapseRate', label: 'Lapse rate (K/km)', min: 0, max: 10, step: 0.1, type: 'range' },
];

const LAYERS = [
  { name: 'Troposphere', top: 12, color: '#22d3ee' },
  { name: 'Stratosphere', top: 50, color: '#a855f7' },
  { name: 'Mesosphere', top: 85, color: '#f97316' },
  { name: 'Thermosphere', top: 600, color: '#ef4444' },
];

function AtmosCanvas({ params, data }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const padX = w * 0.12, padY = h * 0.08;
    const plotH = h - 2 * padY;
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      const yTop = padY + Math.min(1, L.top / params.hMax) * plotH;
      ctx.fillStyle = L.color + '15';
      ctx.fillRect(padX, yTop, w - 2 * padX, (padY + plotH) - yTop);
      ctx.fillStyle = L.color;
      ctx.font = '10px sans-serif';
      ctx.fillText(L.name, padX + 6, yTop + 12);
      ctx.strokeStyle = L.color + '40'; ctx.beginPath(); ctx.moveTo(padX, yTop); ctx.lineTo(w - padX, yTop); ctx.stroke();
    }
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = padX + (i / data.length) * (w - 2 * padX);
      const y = padY + (d.h / params.hMax) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
    ctx.fillText('P(h) = P0 exp(-h/H)', 10, 16);
  }, [params, data]);
  return <CanvasStage ref={ref} />;
}

export default function AtmosphericPressureSim() {
  const [params, setParams] = useState({ T0: 288, M: 28.97, hMax: 100, lapseRate: 6.5 });
  const { T0, M, hMax, lapseRate } = params;
  const R = 8.314, g = 9.81;
  const H = (R * T0) / ((M * 1e-3) * g) / 1000;
  const data = useMemo(() => {
    const arr = [];
    for (let h = 0; h <= hMax; h += hMax / 50) {
      const T = T0 - lapseRate * h;
      const P = 101.325 * Math.exp(-(h * 1000 * M * 1e-3 * g) / (R * Math.max(50, T)));
      arr.push({ h: +h.toFixed(1), P: +P.toFixed(3), T: +T.toFixed(1) });
    }
    return arr;
  }, [params]);
  const Ptop = data[data.length - 1].P;
  const Ttop = T0 - lapseRate * hMax;
  const stats = {
    'Scale height H': `${H.toFixed(2)} km`,
    'P(0)': '101.3 kPa',
    [`P(${hMax}km)`]: `${Ptop.toFixed(3)} kPa`,
    'T(0)': `${T0} K`,
    [`T(${hMax}km)`]: `${Ttop.toFixed(1)} K`,
    'Lapse rate': `${lapseRate} K/km`,
  };
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Atmospheric Pressure — Barometric Stratification" subtitle="P(h) = P0 exp(-h/H). Scale height H = RT/Mg ~ 8.4 km for Earth's air. Pressure falls exponentially; temperature drops linearly in the troposphere (lapse rate)." onExplain={() => explain(`Atmosphere: T0=${T0}K, M=${M}g/mol, H=${H.toFixed(1)}km. P at ${hMax}km = ${Ptop} kPa`)} explaining={explaining} />
      <SimLayout title="Atmospheric Pressure" configName="atmos" canvasRef={{ current: null }} params={params} schema={schema} setParams={setParams}
        controls={<div className="rounded-xl border border-border/60 bg-card/40 p-2 text-xs text-muted-foreground">Exponential pressure decay with altitude.</div>}
        stats={<StatGridLite stats={stats} />}
        graph={<div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey="P" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'P (kPa)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
          <YAxis dataKey="h" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'h (km)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          <Line type="monotone" dataKey="P" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>}
        exportBar={<ExportBar graphData={data} config={params} canvasRef={{ current: null }} name="atmos" />}
        extra={<Card><p className="text-xs text-muted-foreground">Each coloured band is an atmospheric layer. The pressure curve is exponential; at one scale height (~8.4 km) pressure drops to 1/e ~ 37% of sea-level. Venus (M=44) has a larger scale height; Mars (thin, cold) much smaller.</p></Card>} />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}><AtmosCanvas params={params} data={data} /></div>
      <AIPanel output={output} />
    </div>
  );
}

function StatGridLite({ stats }) {
  const entries = Object.entries(stats || {});
  return <div className="grid grid-cols-2 gap-2">{entries.map(([k, v]) => <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div>;
}