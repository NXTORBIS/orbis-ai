/**
 * Reusable interface primitives. Every control is keyboard operable, labelled,
 * and reports validation errors through aria-describedby so assistive
 * technology announces them.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';

/* ---------------------------------------------------------------- Fields */

interface FieldProps {
  label: string;
  symbol?: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, symbol, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="oc-field">
      <label className="oc-field__label" htmlFor={id}>
        <span>{label}</span>
        {symbol && <span className="oc-field__symbol">{symbol}</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p className="oc-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="oc-field__error" id={errorId} role="alert">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  symbol?: string;
  hint?: string;
  error?: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  /** Suffix shown after the input, e.g. a unit. */
  unit?: string;
}

/**
 * Numeric input that keeps the user's raw text while they type (so "0.", "-"
 * and "1e" are not destroyed mid-entry) and reports the parsed value upward.
 */
export function NumberField({ label, symbol, hint, error, value, onChange, min, max, step, integer, disabled, unit }: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const localError = useMemo(() => {
    if (text.trim() === '') return 'Enter a number.';
    const n = Number(text);
    if (!Number.isFinite(n)) return `"${text}" is not a number.`;
    if (integer && !Number.isInteger(n)) return 'Enter a whole number.';
    if (min !== undefined && n < min) return `Enter a value of at least ${min}.`;
    if (max !== undefined && n > max) return `Enter a value of at most ${max}.`;
    return undefined;
  }, [text, integer, min, max]);
  return (
    <Field label={label} symbol={symbol} hint={hint} error={error ?? localError}>
      {({ id, describedBy, invalid }) => (
        <div style={unit ? { display: 'flex', gap: 'var(--s2)', alignItems: 'center' } : undefined}>
          <input
            id={id}
            className="oc-input oc-input--numeric"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={text}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setText(String(value));
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setText(raw);
              // Only a value that satisfies the stated bounds is reported
              // upward. Reporting one the field has just declared invalid sent
              // it on to the engine, which then had to refuse it with an
              // internal diagnostic beside a validation message that already
              // said what was wrong. The raw text stays visible while the
              // person corrects it; the configuration keeps its last good
              // value, and no substituted number is ever shown as a result.
              if (raw.trim() === '') return;
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              if (integer && !Number.isInteger(n)) return;
              if (min !== undefined && n < min) return;
              if (max !== undefined && n > max) return;
              onChange(n);
            }}
            step={step}
          />
          {unit && <span className="oc-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{unit}</span>}
        </div>
      )}
    </Field>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  hint?: string;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  monospace?: boolean;
  disabled?: boolean;
}

export function TextField({ label, value, onChange, hint, error, placeholder, multiline, rows = 3, maxLength, monospace, disabled }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) =>
        multiline ? (
          <textarea
            id={id}
            className="oc-textarea"
            value={value}
            rows={rows}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            style={monospace ? { fontFamily: 'var(--font-mono)' } : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={id}
            className="oc-input"
            type="text"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            style={monospace ? { fontFamily: 'var(--font-mono)' } : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange(value: T): void;
  options: { value: T; label: string; disabled?: boolean }[];
  hint?: string;
  error?: string;
  disabled?: boolean;
}

export function SelectField<T extends string>({ label, value, onChange, options, hint, error, disabled }: SelectFieldProps<T>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="oc-select"
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface SliderFieldProps {
  label: string;
  symbol?: string;
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step: number;
  hint?: string;
  error?: string;
  /** Allow typing a value outside the slider range. */
  allowOutOfRange?: boolean;
  integer?: boolean;
}

export function SliderField({ label, symbol, value, onChange, min, max, step, hint, error, allowOutOfRange = true, integer }: SliderFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const sliderValue = Math.min(max, Math.max(min, value));
  return (
    <div className="oc-field">
      <label className="oc-field__label" htmlFor={id}>
        <span>{label}</span>
        {symbol && <span className="oc-field__symbol">{symbol}</span>}
      </label>
      <div className="oc-slider-row">
        <input
          type="range"
          className="oc-range"
          id={`${id}-range`}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          aria-label={`${label} slider`}
          aria-describedby={describedBy}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          id={id}
          className="oc-input oc-input--numeric"
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(String(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
            if (integer && !Number.isInteger(n)) return;
            if (!allowOutOfRange && (n < min || n > max)) return;
            onChange(n);
          }}
        />
      </div>
      {value > max || value < min ? (
        <p className="oc-field__hint">
          The value {value} is outside the slider range {min}–{max}; the slider shows the nearest end.
        </p>
      ) : null}
      {hint && (
        <p className="oc-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="oc-field__error" id={errorId} role="alert">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Probability input that accepts decimals, percentages and fractions and shows
 * the parsed value in every form.
 */
export function ProbabilityField({
  label,
  value,
  onChange,
  hint,
  error,
  symbol,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  hint?: string;
  error?: string;
  symbol?: string;
}) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const parsed = useMemo(() => {
    if (!text.trim()) return { error: 'Enter a probability.' as string | undefined, value: undefined };
    try {
      // Local import avoids a cycle; parseProbability throws a descriptive error.
      const r = parseProbabilityText(text);
      return { error: undefined, value: r };
    } catch (e) {
      return { error: (e as Error).message, value: undefined };
    }
  }, [text]);
  const display = parsed.value;
  return (
    <Field label={label} symbol={symbol} hint={hint} error={error ?? parsed.error}>
      {({ id, describedBy, invalid }) => (
        <>
          <input
            id={id}
            className="oc-input oc-input--numeric"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder="0.25, 25% or 1/4"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setText(String(value));
            }}
            onChange={(e) => {
              setText(e.target.value);
              try {
                onChange(parseProbabilityText(e.target.value));
              } catch {
                /* keep the previous valid value while the user types */
              }
            }}
          />
          {display !== undefined && (
            <p className="oc-field__hint">
              {display} = {formatPercentLocal(display)}
              {display > 0 && display <= 1 ? ` = about 1 in ${(1 / display >= 100 ? Number((1 / display).toPrecision(3)) : Math.round(100 / display) / 100).toLocaleString('en-US')}` : ''}
            </p>
          )}
        </>
      )}
    </Field>
  );
}

function parseProbabilityText(text: string): number {
  const s = text.trim();
  const pct = /^(-?[\d.]+(?:e[+-]?\d+)?)\s*%$/i.exec(s);
  if (pct) return check(Number(pct[1]) / 100);
  const frac = /^(-?[\d.]+)\s*\/\s*(-?[\d.]+)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    if (d === 0) throw new Error('The denominator cannot be 0.');
    return check(Number(frac[1]) / d);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`"${text}" is not a number, percentage or fraction.`);
  return check(n);
}

function check(n: number): number {
  if (!Number.isFinite(n)) throw new Error('Enter a finite number.');
  if (n < 0 || n > 1) throw new Error(`A probability must be between 0 and 1 (or 0% and 100%); this gives ${Number(n.toPrecision(6))}.`);
  return n;
}

function formatPercentLocal(p: number): string {
  if (p === 0) return '0%';
  if (p === 1) return '100%';
  const pct = p * 100;
  return `${Number(pct.toPrecision(4))}%`;
}

/**
 * A compact numeric input that keeps the text the user is typing.
 *
 * A controlled input bound directly to a number cannot be typed into: the
 * intermediate text "0." parses to 0 and renders back as "0", deleting the
 * decimal point as it is typed, so "0.25" becomes 25. This keeps the raw text
 * while the field has focus and reports each parsed value upward.
 */
export function RawNumberInput({
  value,
  onChange,
  ariaLabel,
  className = 'oc-matrix-input',
  invalid,
  min,
  max,
}: {
  value: number;
  onChange(value: number): void;
  ariaLabel: string;
  className?: string;
  invalid?: boolean;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const parsed = Number(text);
  const outOfRange = Number.isFinite(parsed) && ((min !== undefined && parsed < min) || (max !== undefined && parsed > max));
  return (
    <input
      className={className}
      value={text}
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || text.trim() === '' || !Number.isFinite(parsed) || outOfRange}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className="oc-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="oc-check__text">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange(v: T): void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="oc-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Buttons */

export function Button({
  children,
  onClick,
  variant = 'default',
  size,
  icon,
  disabled,
  block,
  type = 'button',
  title,
  ariaLabel,
}: {
  children?: ReactNode;
  onClick?(): void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm';
  icon?: IconName;
  disabled?: boolean;
  block?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
}) {
  const classes = ['oc-btn'];
  if (variant !== 'default') classes.push(`oc-btn--${variant}`);
  if (size === 'sm') classes.push('oc-btn--sm');
  if (block) classes.push('oc-btn--block');
  if (!children && icon) classes.push('oc-btn--icon');
  return (
    <button type={type} className={classes.join(' ')} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel ?? (!children ? title : undefined)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Cards */

export function Card({ title, hint, actions, children, variant, id }: { title?: string; hint?: string; actions?: ReactNode; children: ReactNode; variant?: 'inset' | 'raised'; id?: string }) {
  const headingId = useId();
  return (
    <section className={`oc-card${variant ? ` oc-card--${variant}` : ''}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {(title || actions) && (
        <header className="oc-card__header">
          <div style={{ minWidth: 0 }}>
            {title && (
              <h2 className="oc-card__title" id={headingId}>
                {title}
              </h2>
            )}
            {hint && <p className="oc-card__hint">{hint}</p>}
          </div>
          {actions && <div className="oc-btn-row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- Notices */

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const TONE_ICON: Record<NoticeTone, IconName> = { info: 'info', warning: 'alert', error: 'alert', success: 'check' };
const TONE_PREFIX: Record<NoticeTone, string> = { info: 'Note', warning: 'Warning', error: 'Problem', success: 'Done' };

export function Notice({ tone = 'info', title, children, items }: { tone?: NoticeTone; title?: string; children?: ReactNode; items?: string[] }) {
  // A notice with nothing in it still drew an icon and the bare word
  // "Warning", which reads as though something is wrong and then says
  // nothing. Several screens pass an `items` array that is empty whenever the
  // engine reported no warnings, which is the common case, so the guard
  // belongs here rather than at each call site.
  const hasItems = items !== undefined && items.length > 0;
  const hasChildren = children !== undefined && children !== null && children !== false;
  if (!hasItems && !hasChildren && title === undefined) return null;
  return (
    <div className={`oc-notice oc-notice--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <span className="oc-notice__icon" aria-hidden="true">
        <Icon name={TONE_ICON[tone]} size={15} />
      </span>
      <div className="oc-notice__body">
        {/* Text prefix so the tone is not conveyed by colour alone. */}
        <strong>{title ?? TONE_PREFIX[tone]}</strong>
        {children}
        {hasItems && (
          <ul>
            {items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Badge({ children, variant }: { children: ReactNode; variant?: 'exact' | 'numerical' | 'empirical' | 'assumed' }) {
  return <span className={`oc-badge${variant ? ` oc-badge--${variant}` : ''}`}>{children}</span>;
}

/* ---------------------------------------------------------------- States */

export function EmptyState({ icon = 'sparkles', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="oc-empty">
      <span className="oc-empty__icon" aria-hidden="true">
        <Icon name={icon} size={44} />
      </span>
      {/* h2: an empty state often follows the page h1 directly, and skipping
          a heading level breaks document structure for screen readers. */}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="oc-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      aria-valuetext={`${value.toLocaleString('en-US')} of ${max.toLocaleString('en-US')}`}
    >
      <div className="oc-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RunningState({ completed, total, unitLabel, onCancel }: { completed: number; total: number; unitLabel: string; onCancel?(): void }) {
  return (
    <div className="oc-running">
      <div className="oc-running__row">
        <span>
          Running: {completed.toLocaleString('en-US')} of {total.toLocaleString('en-US')} {unitLabel} completed
        </span>
        <span className="oc-muted tnum">{total > 0 ? Math.floor((completed / total) * 100) : 0}%</span>
      </div>
      <ProgressBar value={completed} max={total} label={`${unitLabel} completed`} />
      {onCancel && (
        <div>
          <Button size="sm" icon="x" onClick={onCancel}>
            Cancel run
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Disclosure */

export function Disclosure({ title, children, defaultOpen = false, icon }: { title: string; children: ReactNode; defaultOpen?: boolean; icon?: IconName }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className="oc-disclosure" data-open={open}>
      <button type="button" className="oc-disclosure__summary" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((v) => !v)}>
        {icon && <Icon name={icon} size={14} />}
        <span>{title}</span>
        <span className="oc-disclosure__chevron" aria-hidden="true">
          <Icon name="chevronRight" size={14} />
        </span>
      </button>
      {open && (
        <div className="oc-disclosure__content" id={contentId}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose(): void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    // Focus the first focusable element inside the dialog.
    const focusable = node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      // Trap focus inside the dialog.
      const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="oc-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`oc-dialog${wide ? ' oc-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="oc-dialog__header">
          <h2 id={titleId} style={{ flex: 1, minWidth: 0 }}>
            {title}
          </h2>
          <Button icon="x" variant="ghost" title="Close" onClick={onClose} />
        </header>
        <div className="oc-dialog__body">{children}</div>
        {footer && <div className="oc-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', destructive, onConfirm, onCancel }: { title: string; message: ReactNode; confirmLabel?: string; destructive?: boolean; onConfirm(): void; onCancel(): void }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Toasts */

export interface Toast {
  id: string;
  tone: NoticeTone;
  message: string;
}

const ToastContext = createContext<{ push(tone: NoticeTone, message: string): void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: NoticeTone, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    // Errors stay longer because they usually need reading.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 4500);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="oc-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`oc-toast oc-toast--${t.tone}`}>
            <span className="oc-toast__icon" aria-hidden="true">
              <Icon name={TONE_ICON[t.tone]} size={15} />
            </span>
            <div className="oc-toast__body">
              <strong style={{ marginRight: 4 }}>{TONE_PREFIX[t.tone]}:</strong>
              {t.message}
            </div>
            <Button icon="x" variant="ghost" size="sm" title="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------------------------------------------------------------- Tables */

export interface ColumnDef<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render(row: T, index: number): ReactNode;
  /** Shown in the header as a tooltip. */
  title?: string;
}

export function DataTable<T>({ columns, rows, caption, maxHeight, emptyMessage = 'No rows to show.' }: { columns: ColumnDef<T>[]; rows: T[]; caption?: string; maxHeight?: number; emptyMessage?: string }) {
  if (!rows.length) return <p className="oc-muted" style={{ fontSize: 12.5 }}>{emptyMessage}</p>;
  return (
    <div className="oc-table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="oc-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'num' : undefined} title={c.title} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- Misc */

export function KeyValueList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="oc-kv">
      {items.map((it, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Debounce a rapidly changing value (used for live recalculation). */
export function useDebounced<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Measure an element's width so charts can size themselves to the container. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth || 640);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
