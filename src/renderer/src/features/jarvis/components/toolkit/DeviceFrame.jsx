import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Smartphone, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const FRAMES = {
  none: { label: 'No frame', padX: 0, padY: 0, outer: 18, inner: 18, bar: 0, base: 0, body: 'transparent', aspect: null },
  phone: { label: 'Phone', padX: 14, padY: 14, outer: 40, inner: 26, bar: 0, base: 0, body: '#0f172a', aspect: 9 / 19.5, notch: true },
  tablet: { label: 'Tablet', padX: 16, padY: 16, outer: 24, inner: 10, bar: 0, base: 0, body: '#0f172a', aspect: 3 / 4 },
  browser: { label: 'Browser window', padX: 10, padY: 10, outer: 12, inner: 4, bar: 32, base: 0, body: '#0f172a', aspect: 16 / 10, dots: true },
  laptop: { label: 'Laptop', padX: 16, padY: 16, outer: 14, inner: 6, bar: 0, base: 16, body: '#0f172a', aspect: 16 / 10 },
  polaroid: { label: 'Polaroid', padX: 20, padY: 20, outer: 6, inner: 2, bar: 0, base: 48, body: '#e2e8f0', aspect: 1, caption: true },
  watch: { label: 'Watch', padX: 24, padY: 24, outer: 50, inner: 34, bar: 0, base: 0, body: '#0f172a', aspect: 1 },
};

const roundedPath = (context, x, y, width, height, radius) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
};

export default function DeviceFrame() {
  const [image, setImage] = useState('');
  const [naturalAspect, setNaturalAspect] = useState(0);
  const [frame, setFrame] = useState('phone');
  const [zoom, setZoom] = useState(300);
  const [background, setBackground] = useState('#0b1120');
  const [gradient, setGradient] = useState(true);
  const [shadow, setShadow] = useState(true);
  const [caption, setCaption] = useState('Screenshot');
  const inputRef = useRef(null);

  const config = FRAMES[frame] || FRAMES.phone;

  const geometry = useMemo(() => {
    const screenW = zoom;
    const aspect = config.aspect || naturalAspect || 4 / 3;
    const screenH = Math.round(screenW / aspect);
    const outerW = screenW + config.padX * 2;
    const outerH = screenH + config.padY * 2 + config.bar + config.base;
    return { screenW, screenH, outerW, outerH, aspect };
  }, [zoom, config, naturalAspect]);

  const pick = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result);
      const probe = new Image();
      probe.onload = () => {
        setNaturalAspect(probe.naturalWidth / probe.naturalHeight);
        setImage(source);
      };
      probe.src = source;
    };
    reader.readAsDataURL(file);
  };

  const exportFrame = () => {
    if (!image) return;
    const scale = 2;
    const margin = 48;
    const canvas = document.createElement('canvas');
    canvas.width = (geometry.outerW + margin * 2) * scale;
    canvas.height = (geometry.outerH + margin * 2) * scale;
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    const width = geometry.outerW + margin * 2;
    const height = geometry.outerH + margin * 2;

    const backdrop = context.createLinearGradient(0, 0, width, height);
    backdrop.addColorStop(0, background);
    backdrop.addColorStop(1, gradient ? '#1e293b' : background);
    context.fillStyle = backdrop;
    context.fillRect(0, 0, width, height);

    const originX = margin;
    const originY = margin;
    const body = context.createLinearGradient(originX, originY, originX, originY + geometry.outerH);
    body.addColorStop(0, config.body);
    body.addColorStop(1, frame === 'polaroid' ? config.body : '#020617');

    context.save();
    if (shadow) {
      context.shadowColor = 'rgba(0,0,0,0.55)';
      context.shadowBlur = 30;
      context.shadowOffsetY = 14;
    }
    roundedPath(context, originX, originY, geometry.outerW, geometry.outerH, config.outer);
    context.fillStyle = body;
    context.fill();
    context.restore();

    if (config.bar) {
      context.fillStyle = 'rgba(148, 163, 184, 0.14)';
      roundedPath(context, originX, originY, geometry.outerW, config.bar + config.outer, config.outer);
      context.fill();
      ['#f87171', '#fbbf24', '#34d399'].forEach((colour, index) => {
        context.beginPath();
        context.arc(originX + 18 + index * 16, originY + config.bar / 2, 5, 0, Math.PI * 2);
        context.fillStyle = colour;
        context.fill();
      });
      context.fillStyle = 'rgba(148, 163, 184, 0.28)';
      roundedPath(context, originX + 72, originY + config.bar / 2 - 8, geometry.outerW - 96, 16, 8);
      context.fill();
    }

    const screenX = originX + config.padX;
    const screenY = originY + config.padY + config.bar;

    const picture = new Image();
    picture.onload = () => {
      context.save();
      roundedPath(context, screenX, screenY, geometry.screenW, geometry.screenH, config.inner);
      context.clip();
      context.fillStyle = '#020617';
      context.fillRect(screenX, screenY, geometry.screenW, geometry.screenH);
      const ratio = Math.max(geometry.screenW / picture.naturalWidth, geometry.screenH / picture.naturalHeight);
      const drawW = picture.naturalWidth * ratio;
      const drawH = picture.naturalHeight * ratio;
      context.drawImage(picture, screenX + (geometry.screenW - drawW) / 2, screenY + (geometry.screenH - drawH) / 2, drawW, drawH);
      context.restore();

      if (config.notch) {
        context.fillStyle = '#020617';
        roundedPath(context, originX + geometry.outerW / 2 - 34, originY + config.padY - 10, 68, 16, 8);
        context.fill();
      }

      if (config.base) {
        context.fillStyle = frame === 'polaroid' ? config.body : 'rgba(148,163,184,0.25)';
        roundedPath(
          context,
          originX + (frame === 'laptop' ? -26 : 0),
          originY + geometry.outerH - config.base,
          geometry.outerW + (frame === 'laptop' ? 52 : 0),
          config.base,
          frame === 'laptop' ? 8 : 0
        );
        context.fill();
        if (frame === 'laptop') {
          context.fillStyle = 'rgba(15,23,42,0.6)';
          roundedPath(context, originX + geometry.outerW / 2 - 40, originY + geometry.outerH - config.base + 4, 80, 6, 3);
          context.fill();
        }
      }

      if (config.caption && caption) {
        context.fillStyle = '#334155';
        context.font = '600 17px Inter, system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(caption, originX + geometry.outerW / 2, originY + geometry.outerH - 16);
      }

      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'screenshot-framed.png';
      link.click();
    };
    picture.src = image;
  };

  const report = useMemo(() => [
    'Frame: ' + config.label,
    'Screen ' + geometry.screenW + ' × ' + geometry.screenH + ' inside a body of ' + geometry.outerW + ' × ' + geometry.outerH,
    'Exported at 2× as ' + (geometry.outerW * 2) + ' × ' + (geometry.outerH * 2),
    'Backdrop ' + background + (gradient ? ' with a gradient' : ''),
    config.caption && caption ? 'Caption: ' + caption : '',
  ].filter(Boolean).join('\n'), [config, geometry, background, gradient, caption]);

  return (
    <ToolShell
      toolId="device-frame"
      icon={Smartphone}
      title="Screenshot Device Frames"
      desc="Drop a screenshot into a phone, tablet, laptop, browser or polaroid frame, choose the backdrop, and export a clean PNG for a portfolio or a deck."
      state={{ frame, zoom, background, gradient, shadow, caption }}
      onRestore={(restored) => {
        if (restored.frame) setFrame(restored.frame);
        if (restored.zoom !== undefined) setZoom(Number(restored.zoom) || 300);
        if (restored.background) setBackground(restored.background);
        if (typeof restored.gradient === 'boolean') setGradient(restored.gradient);
        if (typeof restored.shadow === 'boolean') setShadow(restored.shadow);
        if (typeof restored.caption === 'string') setCaption(restored.caption);
      }}
      exportText={report}
      exportName="frame-settings.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Your screenshot</div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files && e.target.files[0])}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-cyan-j/15 file:px-3 file:py-1.5 file:text-xs file:text-cyan-j"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The picture is read in your browser and never uploaded anywhere. Wide screenshots suit the browser and laptop frames; tall ones suit the phone.
          </p>
          {image && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setImage('')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                Clear image
              </button>
              <CopyBtn value={report} label="Copy settings" />
            </div>
          )}
        </Panel>
        <div className="space-y-3">
          <Field label="Frame">
            <select value={frame} onChange={(e) => setFrame(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {Object.entries(FRAMES).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
            </select>
          </Field>
          <Field label={'Screen width · ' + zoom + 'px'}>
            <input type="range" min={180} max={560} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Backdrop colour">
              <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
            </Field>
            {config.caption && (
              <Field label="Caption">
                <input value={caption} onChange={(e) => setCaption(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="Gradient backdrop" checked={gradient} onChange={setGradient} />
            <ToggleRow label="Drop shadow" checked={shadow} onChange={setShadow} />
          </div>
          <button
            type="button"
            onClick={exportFrame}
            disabled={!image}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" /> Export framed PNG
          </button>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium">Preview</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{geometry.outerW} × {geometry.outerH}</span>
        </div>
        <div className="flex justify-center">
          <div
            style={{
              width: geometry.outerW,
              height: geometry.outerH,
              background: gradient ? 'linear-gradient(160deg, ' + background + ', #1e293b)' : background,
              borderRadius: config.outer,
              boxShadow: shadow ? '0 24px 50px -22px rgb(0 0 0 / 0.7)' : 'none',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: geometry.outerW, height: geometry.outerH, background: config.body, overflow: 'hidden' }}>
              {config.bar > 0 && (
                <div className="flex items-center gap-1.5 bg-white/5 px-3" style={{ height: config.bar }}>
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-3 h-4 flex-1 rounded-full bg-white/15" />
                </div>
              )}
              <div style={{ padding: config.padX, paddingTop: config.padY, paddingBottom: config.padY }}>
                {config.notch && (
                  <div className="mx-auto mb-2 rounded-full" style={{ width: 68, height: 14, background: '#020617' }} />
                )}
                {image ? (
                  <img
                    src={image}
                    alt="Screenshot being framed"
                    style={{ width: geometry.screenW, height: geometry.screenH, objectFit: 'cover', borderRadius: config.inner, display: 'block' }}
                  />
                ) : (
                  <div
                    className="grid place-items-center border border-dashed border-white/20 text-center"
                    style={{ width: geometry.screenW, height: geometry.screenH, borderRadius: config.inner }}
                  >
                    <div>
                      <ImageIcon className="mx-auto h-6 w-6 text-slate-500" strokeWidth={1.5} />
                      <p className="mt-2 text-[11px] text-slate-400">Choose a screenshot above</p>
                    </div>
                  </div>
                )}
                {config.base > 0 && frame === 'laptop' && (
                  <div className="mt-3 h-2 rounded-full bg-white/20" style={{ width: geometry.outerW - config.padX * 2 }} />
                )}
                {config.caption && (
                  <p className="mt-3 text-center text-[13px] font-semibold text-slate-700">{caption}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={config.label + ' frame'}
          value={geometry.screenW + ' × ' + geometry.screenH}
          sub={'Inner screen at ' + config.inner + 'px corner radius, inside a body of ' + geometry.outerW + ' × ' + geometry.outerH + '. The export renders at twice this size.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizes worth knowing</div>
          <div className="space-y-1 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Screen</span><span>{geometry.screenW} × {geometry.screenH}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Aspect</span><span>{geometry.aspect.toFixed(2)} : 1</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Frame body</span><span>{geometry.outerW} × {geometry.outerH}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>Export</span><span className="text-cyan-j">{geometry.outerW * 2} × {geometry.outerH * 2}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Making screenshots look deliberate</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Use the real screen size. A phone frame around a desktop capture reads as a mistake rather than a choice.</p>
            <p>· Crop to the interesting part first — a full-screen capture shrunk into a frame is unreadable at any size.</p>
            <p>· The browser frame earns its place for web products and the phone frame for apps; mixing them in one gallery confuses the story.</p>
            <p>· A gradient backdrop drawn from the product's own colours looks intentional; a random bright colour does not.</p>
            <p>· Keep the shadow subtle. It separates the device from the background, it is not the subject.</p>
            <p>· Export at 2× — the extra pixels matter the moment the image is placed in a document that scales it.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Frames available</div>
          <div className="space-y-1">
            {Object.entries(FRAMES).map(([key, entry]) => (
              <div key={key} className={key === frame ? 'rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5 text-[11px]' : 'rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]'}>
                <div className="flex items-center justify-between">
                  <span>{entry.label}</span>
                  <span className="font-mono-j text-[10px] text-muted-foreground">{entry.aspect ? 'fixed aspect' : 'matches the image'}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Frame', value: config.label },
                { label: 'Width', value: zoom + 'px' },
                { label: 'Export', value: '2× PNG' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Frame" value={config.label.split(' ')[0]} mono />
        <Stat label="Screen" value={geometry.screenW + 'w'} mono sub={geometry.screenH + ' tall'} />
        <Stat label="Body border" value={String(config.padX * 2) + 'px'} mono />
        <Stat label="Export" value={(geometry.outerW * 2) + 'w'} mono sub="pixels" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the export works</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The picture is drawn onto a canvas at double resolution with the frame body, chrome and caption painted around it, rather than screenshotting the preview.</p>
          <p>· The image is cropped to fill the screen area, centred, so a screenshot with the wrong aspect still looks deliberate inside the frame.</p>
          <p>· The browser frame draws real window dots and an address bar pill, so it reads as a window rather than a rounded rectangle.</p>
          <p>· Nothing is uploaded and no server is involved, so this behaves the same on a slow connection as on a fast one.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The frames are composed from plain geometry, so the preview and the exported PNG agree exactly at whatever width you choose. Change the frame or the width
          and both update together — the numbers in the panel above are the same ones used to draw the file.
        </p>
      </Panel>
    </ToolShell>
  );
}