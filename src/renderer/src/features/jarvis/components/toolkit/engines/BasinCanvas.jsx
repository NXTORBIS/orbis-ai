import { useEffect, useRef } from 'react';
import { Button } from '@jarvis/components/ui/button';
import { downloadBlob } from '@jarvis/components/toolkit/shared';

const HUES = [189, 265, 160, 38, 350];

/** The basin map itself: one colour per root, with the boundary and a click to trace Newton. */
export default function BasinCanvas({ result, showBoundary, trail, onPick }) {
  const canvas = useRef(null);

  useEffect(() => {
    if (!result || !canvas.current) return;
    const { n, index, boundary } = result;
    const ctx = canvas.current.getContext('2d');
    const image = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i += 1) {
      const root = index[i];
      if (root < 0) {
        image.data[4 * i] = 40; image.data[4 * i + 1] = 40; image.data[4 * i + 2] = 48; image.data[4 * i + 3] = 255;
        continue;
      }
      const hue = HUES[root % HUES.length];
      const onEdge = showBoundary && boundary[i];
      const lightness = onEdge ? 78 : 46;
      const saturation = onEdge ? 95 : 62;
      const colour = `hsl(${hue} ${saturation}% ${lightness}%)`;
      const sample = document.createElement('canvas').getContext('2d');
      sample.fillStyle = colour;
      sample.fillRect(0, 0, 1, 1);
      const rgb = sample.getImageData(0, 0, 1, 1).data;
      image.data[4 * i] = rgb[0]; image.data[4 * i + 1] = rgb[1]; image.data[4 * i + 2] = rgb[2]; image.data[4 * i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [result, showBoundary]);

  if (!result) return null;
  const { n, extent } = result;
  const toPercent = (value) => ((value + extent) / (2 * extent)) * 100;

  return (
    <div className="space-y-2">
      <div className="relative mx-auto max-w-xl">
        <canvas
          ref={canvas}
          width={n}
          height={n}
          className="aspect-square w-full rounded-xl border border-border bg-background"
          aria-label={`Basins of attraction of ${result.label} on a ${n} by ${n} grid`}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onPick(
              -extent + ((event.clientX - box.left) / box.width) * 2 * extent,
              extent - ((event.clientY - box.top) / box.height) * 2 * extent,
            );
          }}
        />
        {trail && trail.length > 1 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            <polyline points={trail.map((point) => `${toPercent(point.x)},${toPercent(-point.y)}`).join(' ')} fill="none" stroke="hsl(var(--foreground))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            {trail.map((point, i) => <circle key={i} cx={toPercent(point.x)} cy={toPercent(-point.y)} r={i === 0 ? 1.1 : 0.5} fill={i === 0 ? 'hsl(var(--foreground))' : 'hsl(var(--cyan))'} vectorEffect="non-scaling-stroke" />)}
          </svg>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">Click anywhere to run Newton from that point and watch the iterates. Brighter pixels are boundary pixels, where neighbouring pixels land on different roots.</p>
        <Button size="sm" variant="outline" onClick={() => canvas.current.toBlob((blob) => { if (blob) downloadBlob(blob, `basins-${result.name}-${n}.png`); })}>Save PNG</Button>
      </div>
    </div>
  );
}