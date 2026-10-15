import React, { useEffect, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { ViewRenderer } from './views';

// Reference layout width for non-fill views — they lay out at this width, then scale to fit.
const REF_W = 1000;

export default function ExpandedView({ step, algoName, onClose }) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const roRef = useRef(null);
  const [scale, setScale] = useState(1);

  // Bar view fills the overlay natively (no scaling) — no wasted space.
  const isFillView = step?.view === 'bar';

  useEffect(() => {
    if (isFillView) return;
    const compute = () => {
      const overlay = overlayRef.current;
      const content = contentRef.current;
      if (!overlay || !content) return;
      const pad = 24;
      const availW = overlay.clientWidth - pad;
      const availH = overlay.clientHeight - pad;
      const nW = content.offsetWidth;
      const nH = content.offsetHeight;
      if (!nW || !nH) return;
      const s = Math.min(availW / nW, availH / nH);
      setScale(Math.max(0.3, Math.min(3, s)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    roRef.current = ro;
    if (overlayRef.current) ro.observe(overlayRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [isFillView]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/60 shrink-0">
        <span className="text-sm font-semibold">{algoName} — Visualization</span>
        <button onClick={onClose} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-cyan-j transition-colors btn-press" aria-label="Minimize">
          <Minimize2 className="h-4 w-4" /> Minimize
        </button>
      </div>
      <div ref={overlayRef} className="flex-1 flex items-center justify-center overflow-hidden p-3">
        {isFillView ? (
          <div className="w-full h-full">
            <ViewRenderer step={step} fill />
          </div>
        ) : (
          <div ref={contentRef} style={{ width: `${REF_W}px`, transform: `scale(${scale})`, transformOrigin: 'center center' }}>
            <ViewRenderer step={step} />
          </div>
        )}
      </div>
    </div>
  );
}