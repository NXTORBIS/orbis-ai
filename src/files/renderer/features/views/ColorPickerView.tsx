import React, { useState, useCallback, useRef } from 'react';
import { Icon } from '../../ui/Icon';

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = s / 100, ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: clamp255(f(0) * 255), g: clamp255(f(8) * 255), b: clamp255(f(4) * 255) };
}

function complementary(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const c = hslToRgb((h + 180) % 360, s, l);
  return rgbToHex(c.r, c.g, c.b);
}

function luminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const a = hexToRgb(hex1), b = hexToRgb(hex2);
  const l1 = luminance(a.r, a.g, a.b), l2 = luminance(b.r, b.g, b.b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const MAX_HISTORY = 20;

export function ColorPickerView() {
  const [color, setColor] = useState('#3b82f6');
  const [saved, setSaved] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(['#3b82f6']);
  const [copied, setCopied] = useState<string | null>(null);
  const [hexInput, setHexInput] = useState('#3b82f6');
  const [fg, setFg] = useState('#111827');
  const [bg, setBg] = useState('#ffffff');
  const [fgText, setFgText] = useState('#111827');
  const [bgText, setBgText] = useState('#ffffff');
  const timer = useRef<number | null>(null);

  const pick = useCallback((hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setColor(n);
    setHexInput(n);
    setHistory((h) => [n, ...h.filter((x) => x !== n)].slice(0, MAX_HISTORY));
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(text);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1200);
  }, []);

  const saveColor = useCallback(() => {
    setSaved((s) => (s.includes(color) ? s : [...s, color]));
  }, [color]);

  const { r, g, b } = hexToRgb(color);
  const { h, s, l } = rgbToHsl(r, g, b);
  const comp = complementary(color);
  const formats = [
    { label: 'HEX', value: color.toUpperCase() },
    { label: 'RGB', value: `rgb(${r}, ${g}, ${b})` },
    { label: 'HSL', value: `hsl(${h}, ${s}%, ${l}%)` },
  ];

  const ratio = contrastRatio(fg, bg);
  const checks = [
    { label: 'AA normal text', min: 4.5 },
    { label: 'AA large text', min: 3 },
    { label: 'AAA normal text', min: 7 },
    { label: 'AAA large text', min: 4.5 },
  ];

  const swatchButton = (hex: string, key: string, extra?: React.ReactNode) => (
    <div key={key} className="color-picker-chip">
      <button
        type="button"
        className="color-picker-chip-swatch"
        style={{ background: hex, width: 36, height: 36, borderRadius: 6, border: '1px solid var(--border, #8884)', cursor: 'pointer' }}
        title={hex}
        aria-label={`Select ${hex}`}
        onClick={() => pick(hex)}
      />
      {extra}
    </div>
  );

  const copyBtn = (text: string) => (
    <button type="button" className="color-picker-copy" title={`Copy ${text}`} aria-label={`Copy ${text}`} onClick={() => copy(text)}>
      <Icon name={copied === text ? 'check' : 'copy'} size={14} />
    </button>
  );

  const contrastInput = (
    label: string,
    value: string,
    text: string,
    setValue: (v: string) => void,
    setText: (v: string) => void,
  ) => (
    <div className="color-picker-contrast-field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={value}
          aria-label={`${label} color`}
          onChange={(e) => { setValue(e.target.value); setText(e.target.value); }}
        />
        <input
          type="text"
          value={text}
          spellCheck={false}
          aria-label={`${label} hex`}
          onChange={(e) => {
            setText(e.target.value);
            const n = normalizeHex(e.target.value);
            if (n) setValue(n);
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="tool-view scroll-y color-picker">
      <header className="view-header">
        <h1><Icon name="palette" size={20} /> Color Picker</h1>
      </header>

      <section className="color-picker-main" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="color-picker-preview" style={{ background: color, minWidth: 200, minHeight: 140, flex: '1 1 240px', borderRadius: 10, border: '1px solid var(--border, #8884)' }} aria-label={`Preview ${color}`} />
        <div className="color-picker-controls" style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
          <input type="color" className="color-picker-input" value={color} aria-label="Pick color" onChange={(e) => pick(e.target.value)} style={{ width: 80, height: 48 }} />
          <input
            type="text"
            className="color-picker-hex-input"
            value={hexInput}
            spellCheck={false}
            aria-label="Hex value"
            onChange={(e) => {
              setHexInput(e.target.value);
              const n = normalizeHex(e.target.value);
              if (n) {
                setColor(n);
              }
            }}
            onBlur={() => {
              const n = normalizeHex(hexInput);
              if (n) pick(n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = normalizeHex(hexInput);
                if (n) pick(n);
              }
            }}
          />
          <button type="button" className="color-picker-save" onClick={saveColor}>
            <Icon name="plus" size={14} /> Save color
          </button>
        </div>
        <div className="color-picker-complement" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3>Complementary</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {swatchButton(comp, 'comp')}
            <code>{comp.toUpperCase()}</code>
            {copyBtn(comp.toUpperCase())}
          </div>
        </div>
      </section>

      <section className="color-picker-formats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        {formats.map((f) => (
          <div key={f.label} className="color-picker-format" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>{f.label}</strong>
            <code>{f.value}</code>
            {copyBtn(f.value)}
          </div>
        ))}
      </section>

      <section className="color-picker-saved" style={{ marginTop: 16 }}>
        <h3>Saved Colors</h3>
        {saved.length === 0 ? (
          <p className="color-picker-empty">No saved colors yet. Use "Save color" to add one.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {saved.map((c) =>
              swatchButton(c, c,
                <button type="button" className="color-picker-remove" title="Remove" aria-label={`Remove ${c}`} onClick={() => setSaved((s) => s.filter((x) => x !== c))}>
                  <Icon name="trash" size={12} />
                </button>,
              ),
            )}
          </div>
        )}
      </section>

      <section className="color-picker-history" style={{ marginTop: 16 }}>
        <h3>History</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {history.map((c) => swatchButton(c, 'h' + c))}
        </div>
        {history.length > 0 && (
          <button type="button" className="color-picker-clear" onClick={() => setHistory([])} style={{ marginTop: 8 }}>
            <Icon name="x" size={12} /> Clear history
          </button>
        )}
      </section>

      <section className="color-picker-contrast" style={{ marginTop: 16 }}>
        <h3>Contrast Checker</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {contrastInput('Foreground', fg, fgText, setFg, setFgText)}
          {contrastInput('Background', bg, bgText, setBg, setBgText)}
        </div>
        <div className="color-picker-contrast-sample" style={{ background: bg, color: fg, padding: 16, borderRadius: 8, marginTop: 12, border: '1px solid var(--border, #8884)' }}>
          <strong style={{ fontSize: 24 }}>Large sample text</strong>
          <p style={{ margin: 0 }}>Normal sample text for contrast.</p>
        </div>
        <p className="color-picker-ratio" style={{ fontSize: 20, fontWeight: 600 }}>
          {ratio.toFixed(2)}:1
        </p>
        <div className="color-picker-results" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {checks.map((c) => {
            const pass = ratio >= c.min;
            return (
              <div key={c.label} className={'color-picker-result ' + (pass ? 'pass' : 'fail')} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Icon name={pass ? 'check' : 'x'} size={14} />
                <span>{c.label}: {pass ? 'Pass' : 'Fail'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
