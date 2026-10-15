// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { FileEntry } from '../../shared/model';
import { categoryOfEntry } from './format';

/* ---------------------------------------------------------------- buttons */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: string; size?: 'sm' | 'md' };

export function Button({ variant = 'default', icon, size = 'md', className = '', children, ...rest }: BtnProps) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant} btn-${size} ${className}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** Icon-only button: always has an accessible label and a tooltip. */
export function IconButton({ icon, label, shortcut, active, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; shortcut?: string; active?: boolean }) {
  return (
    <button type="button" aria-label={label} data-tip={shortcut ? `${label} (${shortcut})` : label} aria-pressed={active} {...rest} className={`icon-btn ${active ? 'is-active' : ''} ${className}`}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/* ---------------------------------------------------------------- menus */

export interface MenuItem {
  id?: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  run?: () => void;
}

export const SEP: MenuItem = { label: '', separator: true };

/** Context or dropdown menu with full keyboard support. */
export function Menu({ items, x, y, onClose, anchor, flipX, onBack }: { items: MenuItem[]; x: number; y: number; onClose: () => void; anchor?: 'left' | 'right'; /** Right edge to use instead when the menu does not fit to the right of x (submenus open to the left). */ flipX?: number; /** Submenus: Escape and Left close only this level and return to the parent menu. */ onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(() => items.findIndex((i) => !i.separator && !i.disabled));
  const [sub, setSub] = useState<number | null>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Layout size, not getBoundingClientRect: the opening animation scales the menu down, which would
    // under-measure it and let its last items run off the bottom or right edge of the window.
    const r = { width: el.offsetWidth, height: el.offsetHeight };
    const fitsRight = x + r.width <= window.innerWidth - 6;
    const left = anchor === 'right' ? x - r.width : !fitsRight && flipX !== undefined ? flipX - r.width : x;
    const nx = Math.min(left, window.innerWidth - r.width - 6);
    const ny = Math.min(y, window.innerHeight - r.height - 6);
    setPos({ x: Math.max(6, nx), y: Math.max(6, ny) });
    el.focus();
  }, [x, y, anchor, flipX]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.menu')) onClose();
    };
    const onBlur = () => onClose();
    const restoreTo = prevFocus.current as HTMLElement | null;
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      restoreFocus(restoreTo);
    };
  }, [onClose]);

  const move = (d: 1 | -1) => {
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + d + items.length) % items.length;
      if (!items[i]!.separator) break;
    }
    setActive(i);
  };

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.separator || it.disabled) return;
    if (it.submenu) {
      setSub(i);
      return;
    }
    onClose();
    it.run?.();
  };

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // A submenu is a React child of its parent menu (through a portal): keys it handles must not
        // also move or activate the parent menu.
        if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' ', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation();
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(active); }
        else if (e.key === 'ArrowRight' && items[active]?.submenu) { e.preventDefault(); setSub(active); }
        else if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); (onBack ?? onClose)(); }
        else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
      }}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : (
          <div
            key={it.id ?? it.label}
            role="menuitem"
            aria-disabled={it.disabled}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            className={`menu-item ${i === active ? 'is-active' : ''} ${it.disabled ? 'is-disabled' : ''} ${it.danger ? 'is-danger' : ''}`}
            title={it.disabled ? it.reason : undefined}
            onMouseEnter={() => {
              setActive(i);
              setSub(it.submenu ? i : null);
            }}
            onClick={() => activate(i)}
          >
            <span className="menu-icon">{it.checked !== undefined ? it.checked && <Icon name="check" size={14} /> : it.icon && <Icon name={it.icon} size={14} />}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            {it.submenu && <Icon name="chevronRight" size={13} className="menu-sub-arrow" />}
            {sub === i && it.submenu && <SubMenu parent={ref} index={i} items={it.submenu} onClose={onClose} onBack={() => setSub(null)} />}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}

function SubMenu({ parent, index, items, onClose, onBack }: { parent: React.RefObject<HTMLDivElement>; index: number; items: MenuItem[]; onClose: () => void; onBack: () => void }) {
  const row = parent.current?.querySelectorAll('[role="menuitem"]')[index] as HTMLElement | undefined;
  const r = row?.getBoundingClientRect();
  if (!r) return null;
  return <Menu items={items} x={r.right - 4} y={r.top - 4} flipX={r.left + 4} onClose={onClose} onBack={onBack} />;
}

export function useMenu() {
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number; anchor?: 'left' | 'right' } | null>(null);
  const node = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open: (items: MenuItem[], x: number, y: number, anchor?: 'left' | 'right') => setMenu({ items, x, y, anchor }), node, close: () => setMenu(null) };
}

/**
 * Give focus back to where it was before a menu or dialog opened. When that element is gone
 * (e.g. the command palette that ran the command), focus goes to the active pane's list instead
 * of being lost on the page body, so the keyboard keeps working.
 */
export function restoreFocus(to: HTMLElement | null): void {
  if (to && to.isConnected && to !== document.body) {
    to.focus?.();
    return;
  }
  if (document.activeElement && document.activeElement !== document.body) return;
  for (const sel of ['.pane.is-active .fileview', '.pane.is-active [tabindex="0"]', '.pane.is-active button:not([disabled])']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  }
}

/* ---------------------------------------------------------------- dialogs */

export function Dialog({ title, onClose, children, footer, width = 460, labelledBy, className = '' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; labelledBy?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(document.activeElement);
  const enterDown = useRef(false);
  const id = labelledBy ?? `dlg-${Math.random().toString(36).slice(2)}`;
  useEffect(() => {
    const el = ref.current;
    // Focus priority: explicit autofocus, first field, primary action, then any body/footer button.
    // The header's Close button is never the initial focus.
    const pick = (sel: string) => el?.querySelector<HTMLElement>(`.dialog-body ${sel}, .dialog-foot ${sel}`);
    // Disabled controls cannot take focus; fall back to the dialog itself so Escape and Tab still work.
    const first = pick('[data-autofocus]') ?? pick('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? pick('button.btn-primary:not([disabled])') ?? pick('button:not([disabled])');
    (first ?? el)?.focus();
    const restoreTo = prev.current as HTMLElement | null;
    return () => restoreFocus(restoreTo);
  }, []);
  // If the focused control disappears (e.g. content replaced after an action), focus falls to
  // the page body; keep Escape working and bring focus back into the dialog.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (a && a !== document.body && ref.current?.contains(a)) return;
      if (a && a !== document.body) return; // focus is in another layer (menu, nested dialog)
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    // When the focused control is replaced (e.g. Run becomes the result), bring focus back to the
    // dialog itself, so Tab and screen readers stay in the dialog instead of starting on the page.
    // (A removed element fires no focus event inside the dialog, so watch the dialog's content.)
    const el = ref.current;
    const refocus = () => {
      const dialogs = document.querySelectorAll('.dialog');
      if (!el?.isConnected || document.activeElement !== document.body || dialogs[dialogs.length - 1] !== el) return;
      // The content area when it scrolls (so the arrow and page keys read on), otherwise the dialog.
      const body = el.querySelector<HTMLElement>('.dialog-body');
      (body && body.scrollHeight > body.clientHeight ? body : el).focus({ preventScroll: true });
    };
    const mo = new MutationObserver(refocus);
    if (el) mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={`dialog ${className}`}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        // An Enter that opened this dialog (pressed in the command palette, a menu or a list) can
        // deliver its character after the dialog has focus; without its own key-down it must not
        // submit the dialog's form (e.g. create a file with the suggested name unseen).
        onKeyDownCapture={(e) => {
          if (e.key === 'Enter') enterDown.current = true;
        }}
        onKeyPressCapture={(e) => {
          if (e.key === 'Enter' && !enterDown.current) e.preventDefault();
        }}
        onKeyUpCapture={(e) => {
          if (e.key === 'Enter') enterDown.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') trapFocus(e, ref.current);
        }}
      >
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body" tabIndex={-1}>{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function trapFocus(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------------------------------------------------------- inputs */

export function TextField({ label, hint, error, mono, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string; mono?: boolean }) {
  const id = rest.id ?? `f-${label?.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <label className={`field ${error ? 'has-error' : ''}`} htmlFor={id}>
      {label && <span className="field-label">{label}</span>}
      <input {...rest} id={id} className={`input ${mono ? 'mono' : ''} ${rest.className ?? ''}`} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} />
      {(error || hint) && <span id={`${id}-msg`} className={error ? 'field-error' : 'field-hint'}>{error ?? hint}</span>}
    </label>
  );
}

/**
 * Password input with a show/hide toggle. The value only lives in the
 * caller's React state; the field never stores, autocompletes or spell-checks it.
 */
export const PasswordField = React.forwardRef<HTMLInputElement, { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; autoFocus?: boolean; disabled?: boolean; maxLength?: number }>(function PasswordField({ id, label, value, onChange, error, hint, autoFocus, disabled, maxLength }, ref) {
  const [shown, setShown] = useState(false);
  const msgId = `${id}-msg`;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          ref={ref}
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          data-autofocus={autoFocus || undefined}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={!!error}
          aria-describedby={error || hint ? msgId : undefined}
        />
        <IconButton icon={shown ? 'eyeOff' : 'eye'} label="Show password" active={shown} aria-controls={id} disabled={disabled} onClick={() => setShown(!shown)} />
      </div>
      {(error || hint) && <span id={msgId} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>{error ?? hint}</span>}
    </div>
  );
});

/** On/off switch row. `action` (e.g. a small "Reset to default" button) sits between the text and the switch. */
export function Toggle({ checked, onChange, label, description, disabled, id, action }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean; id: string; action?: ReactNode }) {
  return (
    <div className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <div className="toggle-text">
        <label htmlFor={id}>{label}</label>
        {description && <p>{description}</p>}
      </div>
      {action}
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, label, id }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label?: string; id: string }) {
  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field-label">{label}</span>}
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; icon?: string; disabled?: boolean; reason?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)} title={o.disabled && o.reason ? `${o.label} — ${o.reason}` : o.label}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {(!o.icon || options.length <= 3) && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Tab strip (WAI-ARIA tabs, automatic activation): one Tab stop; Left/Right
 * (and Home/End) move between tabs. Wraps onto several lines in narrow panes.
 * The panel is rendered by the caller with `role="tabpanel"` and
 * `aria-labelledby={tabId(idPrefix, value)}`.
 */
export function Tabs<T extends string>({ value, tabs, onChange, label, idPrefix }: { value: T; tabs: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; label: string; idPrefix: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next]!;
    onChange(t.value);
    refs.current[t.value]?.focus();
  };
  return (
    <div className="tabs-inline" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => { refs.current[t.value] = el; }}
          id={tabId(idPrefix, t.value)}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={value === t.value ? 0 : -1}
          className={value === t.value ? 'on' : ''}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function tabId(prefix: string, value: string): string {
  return `${prefix}-tab-${value}`;
}

/** Sortable column header: a button inside the th, with aria-sort on the th. */
export function SortHeader<K extends string>({ label, sortKey, sort, onSort, numeric, className }: { label: string; sortKey: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (s: { key: K; dir: 'asc' | 'desc' }) => void; numeric?: boolean; className?: string }) {
  const active = sort.key === sortKey;
  return (
    <th className={[numeric ? 'num' : '', className ?? ''].join(' ').trim() || undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : active ? 'desc' : numeric ? 'desc' : 'asc' })}>
        {label}
        {active && <Icon name={sort.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />}
      </button>
    </th>
  );
}

/* ---------------------------------------------------------------- states */

export function EmptyState({ icon = 'folder', title, body, children }: { icon?: string; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="state state-empty" role="status">
      <div className="state-glyph"><Icon name={icon} size={22} /></div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}

export function ErrorState({ title, body, errorId, children }: { title: string; body?: ReactNode; errorId?: string; children?: ReactNode }) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-glyph"><Icon name="error" size={22} /></div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {errorId && <p className="mono muted">Reference {errorId}</p>}
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="progressbar" aria-label={label} />;
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <Spinner label={label} />
      <p>{label}</p>
    </div>
  );
}

/** Determinate when `value` is given, indeterminate otherwise. Never fabricates a percentage. */
export function ProgressBar({ value, label, tone = 'accent' }: { value?: number; label: string; tone?: 'accent' | 'warning' | 'error' | 'success' }) {
  const pct = value === undefined ? undefined : Math.max(0, Math.min(100, value * 100));
  return (
    <div className={`progress tone-${tone} ${pct === undefined ? 'indeterminate' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === undefined ? undefined : Math.round(pct)}>
      <div className="progress-fill" style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export function Pill({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error'; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ---------------------------------------------------------------- splitter */

/**
 * Drag handle for resizing a panel; reports the new size in px. Keyboard
 * accessible (arrow keys; Shift for larger steps). `side` says where the
 * panel is relative to the handle ('left' = panel before the handle, so
 * dragging forward grows it); `orientation` 'horizontal' resizes heights.
 */
export function Splitter({ onResize, value, min, max, side, label, orientation = 'vertical' }: { onResize: (px: number, done: boolean) => void; value: number; min: number; max: number; side: 'left' | 'right'; label: string; orientation?: 'vertical' | 'horizontal' }) {
  const start = useRef<{ p: number; v: number } | null>(null);
  const horiz = orientation === 'horizontal';
  const pos = (e: React.PointerEvent) => (horiz ? e.clientY : e.clientX);
  const next = (delta: number) => clamp(start.current!.v + (side === 'left' ? delta : -delta), min, max);
  return (
    <div
      className={`splitter ${horiz ? 'splitter-h' : ''}`}
      role="separator"
      aria-orientation={horiz ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const back = horiz ? 'ArrowUp' : 'ArrowLeft';
        const fwd = horiz ? 'ArrowDown' : 'ArrowRight';
        if (e.key === back) { e.preventDefault(); onResize(clamp(value + (side === 'left' ? -step : step), min, max), true); }
        if (e.key === fwd) { e.preventDefault(); onResize(clamp(value + (side === 'left' ? step : -step), min, max), true); }
        if (e.key === 'Home') { e.preventDefault(); onResize(min, true); }
        if (e.key === 'End') { e.preventDefault(); onResize(max, true); }
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { p: pos(e), v: value };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(next(pos(e) - start.current.p), false);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        onResize(next(pos(e) - start.current.p), true);
        start.current = null;
      }}
    />
  );
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------- file icon */

const CAT_ICON: Record<string, [string, string]> = {
  folder: ['folder', 'var(--hue-folder)'], image: ['fileImage', 'var(--hue-image)'], video: ['fileVideo', 'var(--hue-video)'], audio: ['fileAudio', 'var(--hue-audio)'],
  document: ['fileText', 'var(--hue-doc)'], text: ['fileText', 'var(--hue-doc)'], pdf: ['filePdf', 'var(--hue-doc)'], spreadsheet: ['fileSheet', 'var(--hue-code)'],
  presentation: ['fileSlides', 'var(--hue-audio)'], archive: ['fileArchive', 'var(--hue-archive)'], code: ['fileCode', 'var(--hue-code)'], executable: ['fileExe', 'var(--hue-exe)'],
  other: ['file', 'var(--hue-other)'],
};

export function FileIcon({ entry, size = 16 }: { entry: Pick<FileEntry, 'kind' | 'ext' | 'linkTargetKind' | 'statError'>; size?: number }) {
  const cat = categoryOfEntry(entry);
  const [name, color] = entry.statError ? ['warning', 'var(--warning)'] : CAT_ICON[cat] ?? CAT_ICON.other!;
  return (
    <span className="file-icon" style={{ color }}>
      <Icon name={name} size={size} />
      {entry.kind === 'symlink' && <span className={`link-badge ${entry.linkTargetKind === 'broken' ? 'broken' : ''}`} aria-hidden><Icon name="link" size={Math.max(8, size * 0.5)} /></span>}
    </span>
  );
}
