import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Switch } from '@jarvis/components/ui/switch';
import { cn } from '@jarvis/lib/utils';

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(String(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return true;
    } catch { return false; }
  }, []);
  return { copied, copy };
}

export function CopyBtn({ value, label = 'Copy', size = 'sm' }) {
  const { copied, copy } = useCopy();
  return (
    <Button type="button" variant="outline" size={size} onClick={() => copy(value)} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5 text-cyan-j" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function ToolHeader({ title, desc, icon: Icon, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="tk-card tk-glow-ring relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-j/25 via-cyan-j/10 to-transparent text-cyan-j">
            <Icon className="relative z-10 h-5 w-5" strokeWidth={1.6} />
            <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="tk-title-glow font-display text-lg font-bold tracking-tight">{title}</h2>
          <div aria-hidden className="mt-1 h-px w-20 bg-gradient-to-r from-cyan-j/70 via-cyan-j/20 to-transparent" />
          {desc && <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, mono }) {
  return (
    <div className="tk-card tk-glass-panel relative overflow-hidden rounded-lg px-3 py-2">
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-cyan-j/70 via-cyan-j/25 to-transparent" />
      <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-sm font-semibold', mono && 'font-mono-j')}>{value || '—'}</div>
      {sub && <div className="text-[11px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

export function Unsupported({ msg = 'This sensor or API is not available on this device or browser.' }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 backdrop-blur dark:text-amber-400">
      {msg}
    </div>
  );
}

export function Panel({ children, className }) {
  return (
    <div className={cn('tk-card tk-glass-panel tk-topline relative overflow-hidden rounded-xl p-4', className)}>
      {children}
    </div>
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function Seg({ value, onChange, options, size = 'sm' }) {
  return (
    <div className="tk-glass-panel inline-flex flex-wrap gap-1 rounded-xl p-1">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'rounded-lg px-3 py-1.5 font-medium transition',
              size === 'sm' ? 'text-xs' : 'text-sm',
              active ? 'bg-gradient-to-br from-cyan-j/30 via-cyan-j/15 to-transparent text-cyan-j shadow-[0_0_16px_-4px] shadow-cyan-j/70' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Area({ value, onChange, placeholder, rows = 5, mono, className }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn('tk-glass-panel w-full resize-y rounded-md p-3 text-sm focus-glow', mono && 'font-mono-j text-xs', className)}
    />
  );
}

export function Out({ children, label = 'Result', value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {value !== undefined && <CopyBtn value={value} />}
      </div>
      <div className="tk-card tk-glass-panel min-h-20 break-words rounded-md p-3 text-sm">{children}</div>
    </div>
  );
}

export function ToggleRow({ label, checked, onChange, hint }) {
  return (
    <div className="tk-glass-panel flex items-center justify-between gap-3 rounded-lg px-3 py-2">
      <span className="text-sm">
        {label}
        {hint && <span className="ml-1 text-[11px] text-muted-foreground/70">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}