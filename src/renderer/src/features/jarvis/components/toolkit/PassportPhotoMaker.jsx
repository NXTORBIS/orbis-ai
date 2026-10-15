import { useRef, useState } from 'react';
import { Crop, Download, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from './kit/ToolShell';
import { Pills } from './kit/premium';
import { Panel, Seg, Stat, downloadBlob, readFileAsDataURL } from './shared';

const DPI = 300;
const BOX_W = 232;

const SPECS = [
  { id: 'us', label: 'US passport & visa', w: 51, h: 51, head: [25, 35], note: 'Plain white background, head 1 in to 1⅜ in, taken in the last six months, no glasses.' },
  { id: 'schengen', label: 'Schengen / EU', w: 35, h: 45, head: [32, 36], note: 'Plain light background, neutral expression, mouth closed, head 32–36 mm.' },
  { id: 'uk', label: 'UK passport', w: 35, h: 45, head: [29, 34], note: 'Plain light grey or cream background, head 29–34 mm, no shadows behind the head.' },
  { id: 'india', label: 'India passport', w: 35, h: 45, head: [28, 35], note: 'Plain white background, even lighting, no shadows on the face or behind.' },
  { id: 'india-sq', label: 'India visa (square)', w: 51, h: 51, head: [25, 35], note: 'Plain white background, full face, both ears visible where possible.' },
  { id: 'canada', label: 'Canada passport', w: 50, h: 70, head: [31, 36], note: 'Head 31–36 mm, plain white or light background, no head covering unless worn daily.' },
  { id: 'china', label: 'China visa', w: 33, h: 48, head: [28, 33], note: 'Plain white background, head 28–33 mm, neutral expression.' },
  { id: 'japan', label: 'Japan passport', w: 35, h: 45, head: [32, 36], note: 'Head 32–36 mm, plain background, no hat or dark glasses.' },
  { id: 'australia', label: 'Australia passport', w: 35, h: 45, head: [32, 36], note: 'Head 32–36 mm, plain light background, full face in focus.' },
];

const px = (mm) => Math.round((mm / 25.4) * DPI);

function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => { if (blob) downloadBlob(blob, name); }, 'image/png');
}

export default function PassportPhotoMaker() {
  const [specId, setSpecId] = useState('us');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [enhance, setEnhance] = useState(true);
  const [image, setImage] = useState(null);
  const drag = useRef(null);
  const inputRef = useRef(null);

  const spec = SPECS.find((item) => item.id === specId) || SPECS[0];
  const boxH = Math.round((BOX_W * spec.h) / spec.w);
  const cover = image ? Math.max(BOX_W / image.naturalWidth, boxH / image.naturalHeight) : 1;
  const scale = cover * zoom;
  const drawW = image ? image.naturalWidth * scale : 0;
  const drawH = image ? image.naturalHeight * scale : 0;

  const load = async (file) => {
    if (!file) return;
    const src = await readFileAsDataURL(file);
    const loaded = new Image();
    loaded.onload = () => {
      setImage(loaded);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    loaded.src = src;
  };

  const onDown = (event) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (event) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + (event.clientX - drag.current.x),
      y: drag.current.oy + (event.clientY - drag.current.y),
    });
  };
  const onUp = () => { drag.current = null; };

  const renderPhoto = () => {
    if (!image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = px(spec.w);
    canvas.height = px(spec.h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = canvas.width / BOX_W;
    if (enhance) ctx.filter = 'brightness(1.04) contrast(1.06) saturate(1.02)';
    ctx.drawImage(
      image,
      ((BOX_W - drawW) / 2 + offset.x) * k,
      ((boxH - drawH) / 2 + offset.y) * k,
      drawW * k,
      drawH * k,
    );
    return canvas;
  };

  const downloadPhoto = () => {
    const canvas = renderPhoto();
    if (canvas) downloadCanvas(canvas, 'passport-photo-' + spec.id + '.png');
  };

  const downloadSheet = () => {
    const photo = renderPhoto();
    if (!photo) return;
    const sheet = document.createElement('canvas');
    sheet.width = 1800;
    sheet.height = 1200;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const margin = 36;
    const gutter = 22;
    const cols = Math.max(1, Math.floor((sheet.width - margin * 2 + gutter) / (photo.width + gutter)));
    const rows = Math.max(1, Math.floor((sheet.height - margin * 2 + gutter) / (photo.height + gutter)));
    const totalW = cols * photo.width + (cols - 1) * gutter;
    const totalH = rows * photo.height + (rows - 1) * gutter;
    const startX = (sheet.width - totalW) / 2;
    const startY = (sheet.height - totalH) / 2;
    ctx.strokeStyle = '#d4d4d8';
    ctx.lineWidth = 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = startX + col * (photo.width + gutter);
        const y = startY + row * (photo.height + gutter);
        ctx.drawImage(photo, x, y);
        ctx.strokeRect(x - 2.5, y - 2.5, photo.width + 5, photo.height + 5);
      }
    }
    downloadCanvas(sheet, 'passport-print-sheet-6x4.png');
  };

  const guide = {
    top: 8,
    min: 8 + (spec.head[0] / spec.h) * 100,
    max: 8 + (spec.head[1] / spec.h) * 100,
  };

  const perSheet = image ? Math.max(1, Math.floor((1800 - 72 + 22) / (px(spec.w) + 22))) * Math.max(1, Math.floor((1200 - 72 + 22) / (px(spec.h) + 22))) : 0;

  return (
    <ToolShell
      toolId="passport-photo"
      icon={Crop}
      title="Passport & ID Photo Maker"
      desc="Turn any photo into a correctly sized passport or visa picture at 300 DPI, with guides for the head height each country requires. Export a single photo, or a 6 × 4 in print sheet of copies with cut marks."
      state={{ specId, zoom, offset, enhance }}
      onRestore={(restored) => {
        if (typeof restored.specId === 'string') setSpecId(restored.specId);
        if (typeof restored.zoom === 'number') setZoom(restored.zoom);
        if (restored.offset && typeof restored.offset.x === 'number') setOffset(restored.offset);
        if (typeof restored.enhance === 'boolean') setEnhance(restored.enhance);
      }}
      exportText={'Passport photo · ' + spec.label + ' · ' + spec.w + ' × ' + spec.h + ' mm at 300 DPI\n' + spec.note}
      exportName="passport-photo.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {SPECS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSpecId(item.id)}
            className={item.id === specId
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j'
              : 'rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">{spec.w} × {spec.h} mm crop</div>
          <div
            className="relative cursor-grab touch-none overflow-hidden rounded-lg border border-border/70 bg-white active:cursor-grabbing"
            style={{ width: BOX_W, height: boxH }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {image ? (
              <img
                src={image.src}
                alt="Crop preview"
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{ width: drawW, height: drawH, left: (BOX_W - drawW) / 2 + offset.x, top: (boxH - drawH) / 2 + offset.y }}
              />
            ) : (
              <div className="grid h-full w-full place-items-center px-4 text-center text-[11px] text-neutral-500">
                Upload a photo to begin. Drag to reposition, then zoom.
              </div>
            )}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-cyan-j/80" style={{ top: (guide.top / 100) * boxH }} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/80" style={{ top: (guide.min / 100) * boxH }} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/80" style={{ top: (guide.max / 100) * boxH }} />
          </div>
          <div className="mt-2 space-y-2">
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full accent-[hsl(var(--cyan))]"
              aria-label="Zoom"
            />
            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => { load(event.target.files?.[0]); event.target.value = ''; }}
              />
              <Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {image ? 'Replace photo' : 'Upload photo'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
                disabled={!image}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Top guide = crown of the head. The chin should land between the two lower guides.
          </p>
        </Panel>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Photo size" value={spec.w + ' × ' + spec.h + ' mm'} mono sub={px(spec.w) + ' × ' + px(spec.h) + ' px at 300 DPI'} />
            <Stat label="Head height required" value={spec.head[0] + '–' + spec.head[1] + ' mm'} mono sub={((spec.head[0] / spec.h) * 100).toFixed(0) + '–' + ((spec.head[1] / spec.h) * 100).toFixed(0) + '% of the frame'} />
            <Stat label="Copies per 6 × 4 in sheet" value={image ? String(perSheet) : '—'} mono sub="with cut marks" />
            <Stat label="Background" value="Plain white" mono sub="set by the export" />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Export</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={downloadPhoto} disabled={!image}>
                <Download className="h-3.5 w-3.5" /> Photo at 300 DPI
              </Button>
              <Button type="button" variant="outline" onClick={downloadSheet} disabled={!image}>
                <Download className="h-3.5 w-3.5" /> Print sheet (6 × 4 in)
              </Button>
            </div>
            <div className="mt-3">
              <Seg value={enhance ? 'on' : 'off'} onChange={(value) => setEnhance(value === 'on')} options={[{ value: 'on', label: 'Light enhancement' }, { value: 'off', label: 'Original tones' }]} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              The print sheet is a 6 × 4 in canvas at 300 DPI — print it at 100% (no scaling, no fit-to-page) and cut on the marks. Scaling the page is the single
              most common way a printed ID photo ends up the wrong size.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Requirements for {spec.label}</div>
            <p className="text-[11px] text-muted-foreground">{spec.note}</p>
            <div className="mt-3">
              <Pills
                items={[
                  { label: 'Size', value: spec.w + '×' + spec.h + ' mm' },
                  { label: 'Head', value: spec.head[0] + '–' + spec.head[1] + ' mm' },
                  { label: 'Resolution', value: '300 DPI' },
                ]}
              />
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Taking a photo that passes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Stand 1–2 m from a plain wall in even daylight, facing a window rather than with it behind you. A wall shadow behind the head is an automatic rejection.</p>
            <p>· Shoot straight on at eye level, camera vertical. A phone held slightly high makes the head look small and forces you to crop too much.</p>
            <p>· Neutral expression, mouth closed, eyes open, no glasses unless medically required. Nothing covering the forehead or ears where the requirement says so.</p>
            <p>· Use a plain white or very light wall, and check the exported photo — not the preview — for cast shadows before printing.</p>
            <p>· Do not retouch the face. Adjusting brightness is fine; smoothing skin or reshaping features can be treated as a manipulated photograph.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Printing and use</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Print on glossy or matte photo paper. Home inkjets are fine; plain paper tends to look washed out and buckle.</p>
            <p>· Keep the print sheet at 100% scale. "Fit to page" shrinks the photos by a few per cent, which is enough to be refused.</p>
            <p>· Cut on the marks with a craft knife and a steel rule. Scissors leave white edges that show on the form.</p>
            <p>· Many applications also accept a digital upload with a minimum pixel size and a maximum file size — the single-photo export is the one to use there.</p>
            <p>· Requirements change, and embassies sometimes add local variations. Check the issuing authority's current page before you rely on this for an application.</p>
          </div>
          <div className="mt-3">
            <Pills items={[{ label: 'Prints', value: '100% scale' }, { label: 'Paper', value: 'photo' }]} />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Sizes and head-height ranges follow the published guidance for each issuing region, and the export is a true 300 DPI bitmap of exactly those millimetres.
          The crop guides are a proportion of the finished frame, so they stay correct whatever zoom you use. Everything is composited on your own device — the photo
          is never uploaded anywhere.
        </p>
      </Panel>
    </ToolShell>
  );
}