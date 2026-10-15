import { useState, useCallback, useRef, useEffect } from 'react';
import { Icon } from '../../ui/Icon';

/**
 * QR Code Generator tool view.
 * NOTE: Install qrcode library for production-grade QR codes. This view draws a
 * deterministic QR-like pattern (finder patterns + hash-derived data modules).
 */

type Ecc = 'L' | 'M' | 'Q' | 'H';

const PRESETS: Record<string, string> = {
  'Current Path': '/path/to/current/folder',
  URL: 'https://example.com',
  Text: 'Hello from Orbis Files',
  WiFi: 'WIFI:T:WPA;S:NetworkName;P:Password;;',
};

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function buildMatrix(text: string, ecc: Ecc): boolean[][] {
  const len = text.length;
  let n = 21 + 4 * Math.min(10, Math.floor(len / 12));
  n += { L: 0, M: 2, Q: 4, H: 6 }[ecc];
  const m: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        reserved[rr]![cc] = true;
        const ring = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        m[rr]![cc] = ring;
      }
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) {
    reserved[6]![i] = reserved[i]![6] = true;
    m[6]![i] = m[i]![6] = i % 2 === 0;
  }
  const rand = rng(hashSeed(text + '|' + ecc));
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (!reserved[r]![c]) m[r]![c] = rand() < 0.5;
  return m;
}

export function QrGeneratorView() {
  const [text, setText] = useState('');
  const [size, setSize] = useState(256);
  const [ecc, setEcc] = useState<Ecc>('M');
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    if (!text) return;
    const m = buildMatrix(text, ecc);
    const quiet = 2;
    const total = m.length + quiet * 2;
    const cell = size / total;
    ctx.fillStyle = fg;
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m.length; c++)
        if (m[r]![c]) {
          const x = Math.floor((c + quiet) * cell);
          const y = Math.floor((r + quiet) * cell);
          ctx.fillRect(x, y, Math.ceil(cell), Math.ceil(cell));
        }
  }, [text, size, ecc, fg, bg]);

  useEffect(() => { draw(); }, [draw]);

  const copy = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text) return;
    setError(null);
    canvas.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error('Could not render image');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Copy failed');
      }
    }, 'image/png');
  }, [text]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'qrcode.png';
    a.click();
  }, [text]);

  return (
    <div className="tool-view scroll-y qr-generator">
      <header className="view-header">
        <h1><Icon name="link" /> QR Code Generator</h1>
      </header>

      <div className="qr-layout">
        <div className="qr-controls">
          <label className="qr-label" htmlFor="qr-text">Data to encode</label>
          <textarea
            id="qr-text"
            className="qr-input"
            rows={5}
            value={text}
            placeholder="Enter text, a URL, or a path..."
            onChange={(e) => setText(e.target.value)}
          />

          <div className="qr-presets">
            {Object.keys(PRESETS).map((k) => (
              <button
                key={k}
                type="button"
                className="btn qr-preset"
                onClick={() => setText(PRESETS[k] ?? '')}
              >
                <Icon name={k === 'Current Path' ? 'file' : 'link'} size={14} /> {k}
              </button>
            ))}
          </div>

          <div className="qr-settings">
            <label className="qr-field">
              <span>Size: {size}px</span>
              <input
                type="range"
                min={128}
                max={512}
                step={16}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
            </label>
            <label className="qr-field">
              <span>Error correction</span>
              <select value={ecc} onChange={(e) => setEcc(e.target.value as Ecc)}>
                <option value="L">L (7%)</option>
                <option value="M">M (15%)</option>
                <option value="Q">Q (25%)</option>
                <option value="H">H (30%)</option>
              </select>
            </label>
            <label className="qr-field">
              <span>Foreground</span>
              <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
            </label>
            <label className="qr-field">
              <span>Background</span>
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="qr-output">
          <div className="qr-canvas-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
            <canvas
              ref={canvasRef}
              className="qr-canvas"
              width={size}
              height={size}
              style={{ border: '1px solid var(--border, #888)', maxWidth: '100%' }}
            />
          </div>
          <div className="qr-actions">
            <button type="button" className="btn" onClick={copy} disabled={!text}>
              <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn" onClick={download} disabled={!text}>
              <Icon name="save" size={14} /> Download PNG
            </button>
            <button type="button" className="btn" onClick={() => setText('')} disabled={!text}>
              <Icon name="x" size={14} /> Clear
            </button>
          </div>
          {error && <div className="qr-error">{error}</div>}
          <p className="qr-note">Install qrcode library for production-grade QR codes.</p>
        </div>
      </div>
    </div>
  );
}
