import { useState } from 'react';
import { call } from '../api';
import { toast } from '../state/app';
import { Button, Loading } from '../ui/components';
import { Icon } from '../ui/Icon';
import type { ColorPalette as ColorPaletteType, ExtractedColor } from '../../shared/colorExtract';
import { computeHarmonies } from '../../shared/colorExtract';

/**
 * Color palette extractor panel. Shown below image previews.
 * Extracts dominant colours from an image and displays swatches
 * with copy-to-clipboard, export and harmony suggestions.
 */

export function ColorPalettePanel({ imagePath }: { imagePath: string }) {
  const [palette, setPalette] = useState<ColorPaletteType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(8);
  const [selectedColor, setSelectedColor] = useState<ExtractedColor | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const extract = async (n: number) => {
    setLoading(true); setError(null);
    try {
      const p = await call<ColorPaletteType>('color:extract', { path: imagePath, count: n });
      setPalette(p);
      setSelectedColor(p.colors[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  if (!expanded) {
    return (
      <button type="button" className="color-palette-toggle" onClick={() => { setExpanded(true); void extract(count); }}>
        <Icon name="palette" size={14} />
        <span>Extract color palette</span>
      </button>
    );
  }

  const harmonies = selectedColor ? computeHarmonies(selectedColor.hex) : [];

  const copyColor = (text: string) => {
    void call('fs:copyText', { text });
    toast({ level: 'success', title: `Copied ${text}` });
  };

  const exportPalette = (format: 'css' | 'json' | 'text') => {
    if (!palette) return;
    let text = '';
    if (format === 'css') {
      text = ':root {\n' + palette.colors.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join('\n') + '\n}';
    } else if (format === 'json') {
      text = JSON.stringify(palette.colors.map((c) => ({ hex: c.hex, rgb: c.rgb, hsl: c.hsl, weight: c.weight })), null, 2);
    } else {
      text = palette.colors.map((c) => `${c.hex}  rgb(${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b})  hsl(${c.hsl.h}, ${c.hsl.s}%, ${c.hsl.l}%)  ${Math.round(c.weight * 100)}%`).join('\n');
    }
    void call('fs:copyText', { text });
    toast({ level: 'success', title: `Copied palette as ${format.toUpperCase()}` });
    setExportOpen(false);
  };

  return (
    <div className="color-palette-panel">
      <div className="color-palette-header">
        <span className="color-palette-title"><Icon name="palette" size={14} /> Color Palette</span>
        <div className="color-palette-controls">
          <label className="color-palette-count-label">
            Colors:
            <select value={count} onChange={(e) => { const n = Number(e.target.value); setCount(n); void extract(n); }} className="color-palette-select">
              {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div style={{ position: 'relative' }}>
            <Button variant="ghost" size="sm" icon="copy" onClick={() => setExportOpen(!exportOpen)}>Export</Button>
            {exportOpen && (
              <div className="sqlite-export-menu">
                <button type="button" onClick={() => exportPalette('css')}>Copy as CSS variables</button>
                <button type="button" onClick={() => exportPalette('json')}>Copy as JSON</button>
                <button type="button" onClick={() => exportPalette('text')}>Copy as text list</button>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Close palette" onClick={() => setExpanded(false)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      {loading && <Loading label="Extracting colors..." />}
      {error && <p className="color-palette-error"><Icon name="warning" size={14} /> {error}</p>}

      {palette && !loading && (
        <>
          <div className="color-swatches">
            {palette.colors.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`color-swatch ${selectedColor?.hex === c.hex ? 'is-selected' : ''}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => setSelectedColor(c)}
                title={c.hex}
              >
                <span className="color-swatch-weight">{Math.round(c.weight * 100)}%</span>
              </button>
            ))}
          </div>

          {selectedColor && (
            <div className="color-detail">
              <div className="color-detail-preview" style={{ backgroundColor: selectedColor.hex }} />
              <div className="color-detail-values">
                <button type="button" className="color-value" onClick={() => copyColor(selectedColor.hex)}>
                  <span className="color-value-label">HEX</span>
                  <span className="color-value-text mono">{selectedColor.hex}</span>
                  <Icon name="copy" size={12} />
                </button>
                <button type="button" className="color-value" onClick={() => copyColor(`rgb(${selectedColor.rgb.r}, ${selectedColor.rgb.g}, ${selectedColor.rgb.b})`)}>
                  <span className="color-value-label">RGB</span>
                  <span className="color-value-text mono">{selectedColor.rgb.r}, {selectedColor.rgb.g}, {selectedColor.rgb.b}</span>
                  <Icon name="copy" size={12} />
                </button>
                <button type="button" className="color-value" onClick={() => copyColor(`hsl(${selectedColor.hsl.h}, ${selectedColor.hsl.s}%, ${selectedColor.hsl.l}%)`)}>
                  <span className="color-value-label">HSL</span>
                  <span className="color-value-text mono">{selectedColor.hsl.h}, {selectedColor.hsl.s}%, {selectedColor.hsl.l}%</span>
                  <Icon name="copy" size={12} />
                </button>
              </div>
            </div>
          )}

          {harmonies.length > 0 && (
            <div className="color-harmonies">
              <span className="color-harmonies-title">Color harmonies</span>
              <div className="color-harmony-list">
                {harmonies.map((h) => (
                  <div key={h.kind} className="color-harmony">
                    <span className="color-harmony-label">{h.label}</span>
                    <div className="color-harmony-swatches">
                      {h.colors.map((hex, i) => (
                        <button key={i} type="button" className="color-harmony-swatch" style={{ backgroundColor: hex }} onClick={() => copyColor(hex)} title={hex} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
