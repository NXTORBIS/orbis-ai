import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, custom, liveDraft, useCustom } from '../../state/custom';
import { getAt, LAYER_LABEL, type LayerName, type Section } from '../../../shared/customization/resolve';
import { studio } from './studioState';
import { Icon } from '../../ui/Icon';

/**
 * Building blocks of the Customization Studio. Every control edits the real
 * configuration through the customization engine (validated, persisted,
 * undoable); continuous controls show the change live and commit it when they
 * stop moving. Each row shows where its effective value comes from and can
 * reset the override that supplies it.
 */

export type SectionPath = { section: Section; path: string[] };

const key = (p: SectionPath) => `${p.section}.${p.path.join('.')}`;

export function useValue<T>(p: SectionPath): T {
  return useCustom((r) => getAt(r[p.section], p.path) as T);
}

export function useSource(p: SectionPath): LayerName {
  return useCustom((r) => r.sources[key(p)] ?? 'default');
}

/** Write a value to the layer chosen in the Studio (Automatic: where it is defined now). */
export function setValue(p: SectionPath, value: unknown, opts: { live?: boolean; label?: string } = {}): void {
  const target = studio.get().target;
  const op = { op: 'set' as const, target, section: p.section, path: p.path, value, label: opts.label };
  if (opts.live) liveDraft(op);
  else void applyCustom(op, { quiet: true });
}

/** Remove the override that currently supplies a value, so the next layer down shows through. */
export function resetValue(p: SectionPath, source: LayerName): void {
  if (source === 'workspace' || source === 'baseline' || source === 'preset') void applyCustom({ op: 'unset', target: source, section: p.section, path: p.path }, { quiet: true });
}

export function SourceBadge({ source, title }: { source: LayerName; title?: string }) {
  const preset = useCustom((r) => r.preset);
  const ws = useCustom((r) => r.workspace);
  const text = source === 'preset' ? `Preset: ${preset?.name ?? ''}` : source === 'workspace' ? `Workspace: ${ws.name}` : LAYER_LABEL[source];
  return <span className={`source-badge src-${source}`} title={title ?? `Effective value comes from: ${text}`}>{text}</span>;
}

export function SettingRow({ id, label, description, path, children, extra, wide }: { id: string; label: string; description?: React.ReactNode; path?: SectionPath; children: React.ReactNode; extra?: React.ReactNode; wide?: boolean }) {
  const focus = useStore(studio, (s) => s.focusSetting);
  const ref = useRef<HTMLDivElement>(null);
  const source = useCustom((r) => (path ? r.sources[key(path)] ?? 'default' : 'default'));
  const preset = useCustom((r) => r.preset);
  useEffect(() => {
    if (focus === id && ref.current) {
      ref.current.scrollIntoView({ block: 'center' });
      ref.current.classList.add('is-found');
      const first = ref.current.querySelector<HTMLElement>('input, select, button, [tabindex="0"]');
      first?.focus({ preventScroll: true });
      const t = setTimeout(() => ref.current?.classList.remove('is-found'), 1600);
      studio.set({ focusSetting: undefined });
      return () => clearTimeout(t);
    }
  }, [focus, id]);
  const resettable = path && (source === 'baseline' || source === 'workspace' || (source === 'preset' && preset && !preset.builtIn));
  return (
    <div className={`studio-row ${wide ? 'wide' : ''}`} id={`setting-${id}`} ref={ref}>
      <div className="studio-row-text">
        <div className="studio-row-label">
          <span id={`label-${id}`}>{label}</span>
          {path && source !== 'default' && <SourceBadge source={source} />}
        </div>
        {description && <p className="studio-row-desc">{description}</p>}
      </div>
      <div className="studio-row-control">
        {children}
        {resettable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetValue(path!, source)} title={source === 'baseline' ? 'Back to the default' : `Remove this ${source === 'workspace' ? 'workspace' : 'preset'} override`}>
            <Icon name="retry" size={13} /> Reset
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

/** Slider with a live value and accessible label; commits shortly after it stops moving. */
export function Slider({ id, path, min, max, step, format, label }: { id: string; path: SectionPath; min: number; max: number; step: number; format: (v: number) => string; label: string }) {
  const value = useValue<number>(path);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={local} aria-labelledby={`label-${id}`} aria-valuetext={format(local)} onChange={(e) => {
        const v = Number(e.target.value);
        setLocal(v);
        setValue(path, v, { live: true, label });
      }} />
      <output className="tabular">{format(local)}</output>
    </span>
  );
}

export function Choice<T extends string | number | boolean>({ id, path, options }: { id: string; path: SectionPath; options: Array<{ value: T; label: string }> }) {
  const value = useValue<T>(path);
  return (
    <div className="segmented" role="radiogroup" aria-labelledby={`label-${id}`}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => setValue(path, o.value)}>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ id, path, invert }: { id: string; path: SectionPath; invert?: boolean }) {
  const raw = useValue<boolean>(path);
  const on = invert ? !raw : raw;
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={`label-${id}`} className={`switch ${on ? 'on' : ''}`} onClick={() => setValue(path, invert ? on : !on)}>
      <span />
    </button>
  );
}

export function SelectValue<T extends string>({ id, path, options }: { id: string; path: SectionPath; options: Array<{ value: T; label: string }> }) {
  const value = useValue<T>(path);
  return (
    <select className="input" aria-labelledby={`label-${id}`} value={value} onChange={(e) => setValue(path, e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Up/down reorder buttons with accessible names (an alternative to dragging). */
export function MoveButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (to: number) => void }) {
  return (
    <span className="move-btns">
      <button type="button" className="icon-btn" aria-label={`Move ${label} up`} data-tip="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}><Icon name="up" size={14} /></button>
      <button type="button" className="icon-btn" aria-label={`Move ${label} down`} data-tip="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}><Icon name="down" size={14} /></button>
    </span>
  );
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x!);
  return out;
}

/** Drag-to-reorder for simple vertical lists, alongside the move buttons. */
export function useDragList(onDrop: (from: number, to: number) => void, kind: string) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    dragging,
    over,
    props: (i: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragging(i);
        e.dataTransfer.setData(`application/x-orbis-${kind}`, String(i));
        e.dataTransfer.effectAllowed = 'move';
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(`application/x-orbis-${kind}`)) return;
        e.preventDefault();
        setOver(i);
      },
      onDrop: (e: React.DragEvent) => {
        const from = Number(e.dataTransfer.getData(`application/x-orbis-${kind}`));
        setOver(null);
        setDragging(null);
        if (Number.isInteger(from) && from !== i) onDrop(from, i);
      },
    }),
  };
}

export function useServerConfig() {
  return useStore(custom, (s) => s.server.config);
}
