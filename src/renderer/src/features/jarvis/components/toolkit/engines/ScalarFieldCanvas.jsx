import { useEffect, useRef, useState } from 'react';
import { Button } from '@jarvis/components/ui/button';

export default function ScalarFieldCanvas({ values, rows, cols, label, min, max }) {
  const ref = useRef(null), [probe, setProbe] = useState(null);
  const low = min ?? Math.min(...values), high = max ?? Math.max(...values);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d'), image = ctx.createImageData(cols, rows);
    const css = window.getComputedStyle(canvas), read = name => {
      const v = css.getPropertyValue(name).trim().split(/\s+/); return v.map(parseFloat);
    };
    // Convert theme HSL channels to sRGB through the canvas itself.
    const color = hsl => { ctx.fillStyle = `hsl(${hsl[0]} ${hsl[1]}% ${hsl[2]}%)`; ctx.fillRect(0,0,1,1); return ctx.getImageData(0,0,1,1).data; };
    const bg = color(read('--background')), fg = color(read('--cyan'));
    for(let i=0;i<values.length;i++) {
      const u = Math.max(0,Math.min(1,(values[i]-low)/(high-low||1)));
      for(let c=0;c<3;c++)image.data[4*i+c]=bg[c]+(fg[c]-bg[c])*u;
      image.data[4*i+3]=255;
    }
    ctx.putImageData(image,0,0);
  }, [values, rows, cols, low, high]);
  const inspect = e => { const box = e.currentTarget.getBoundingClientRect(); const x = Math.min(cols-1,Math.max(0,Math.floor((e.clientX-box.left)/box.width*cols))), y = Math.min(rows-1,Math.max(0,Math.floor((e.clientY-box.top)/box.height*rows))); setProbe({x,y,value:values[y*cols+x]}); };
  return <div className="space-y-2">
    <p className="text-xs font-semibold">{label}</p>
    <canvas ref={ref} width={cols} height={rows} className="w-full rounded-xl border border-border bg-background" style={{ aspectRatio: `${cols}/${rows}`, imageRendering: 'pixelated' }} role="img" aria-label={label} onPointerMove={inspect} onClick={inspect} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <span>{probe ? `Column ${probe.x}, row ${probe.y}: ${probe.value.toFixed(5)}` : `${low.toFixed(3)} → ${high.toFixed(3)} · hover/tap to inspect`}</span>
      <Button variant="outline" size="sm" onClick={() => { const link=document.createElement('a');link.download=label.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.png';link.href=ref.current.toDataURL('image/png');link.click(); }}>PNG</Button>
    </div>
  </div>;
}