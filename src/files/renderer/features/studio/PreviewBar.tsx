import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { applyPreview, cancelPreview, custom } from '../../state/custom';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';

const PREVIEW_SECONDS = 30;

/**
 * Preview-and-apply: while a change is previewed on the real interface (a
 * layout, preset or workspace), this bar stays on top with Apply and Cancel.
 * If nothing is chosen, the preview ends by itself, so a layout that makes
 * controls hard to reach can never stick. Escape cancels.
 */
export function PreviewBar() {
  const p = useStore(custom, (s) => ({ on: s.preview !== null && !!s.previewLabel, label: s.previewLabel }));
  const [left, setLeft] = useState(PREVIEW_SECONDS);
  const barRef = useRef<HTMLDivElement>(null);
  // The control focused last outside the bar: the preview can rebuild it before the bar mounts.
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !t.closest?.('.preview-bar')) lastFocus.current = t;
    };
    document.addEventListener('focusin', on, true);
    return () => document.removeEventListener('focusin', on, true);
  }, []);
  // An alert dialog takes focus (on Apply, as marked) and gives it back when the preview ends.
  useEffect(() => {
    if (!p.on) return;
    const active = document.activeElement as HTMLElement | null;
    const before = active && active !== document.body ? active : lastFocus.current;
    const key = before?.dataset.focusKey;
    barRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      // Only when focus was lost with the bar (not when the user has moved on elsewhere). A
      // preview that changes the panes rebuilds the button that started it: find it again by its key.
      // The panes settle over a few frames, so look again for a short while while focus is lost.
      for (const ms of [0, 60, 180, 400]) {
        setTimeout(() => {
          if (document.activeElement && document.activeElement !== document.body) return;
          const target = before?.isConnected ? before : key ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null;
          target?.focus();
        }, ms);
      }
    };
  }, [p.on]);
  useEffect(() => {
    if (!p.on) return;
    setLeft(PREVIEW_SECONDS);
    const started = Date.now();
    const t = setInterval(() => {
      const rest = PREVIEW_SECONDS - Math.floor((Date.now() - started) / 1000);
      setLeft(rest);
      if (rest <= 0) cancelPreview();
    }, 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPreview();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [p.on, p.label]);
  if (!p.on) return null;
  return (
    <div className="preview-bar" role="alertdialog" aria-label="Preview" aria-describedby="preview-bar-text" ref={barRef}>
      <Icon name="eye" size={16} />
      <span id="preview-bar-text"><strong>Previewing: {p.label}</strong> <span className="muted">Nothing is saved until you apply. Ends in {Math.max(0, left)} s.</span></span>
      <Button size="sm" variant="primary" data-autofocus onClick={() => void applyPreview()}>Apply</Button>
      <Button size="sm" onClick={cancelPreview}>Cancel</Button>
    </div>
  );
}
