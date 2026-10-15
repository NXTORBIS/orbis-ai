import { useCallback, useEffect, useRef, useState } from 'react';
import { PenTool, Trash2, Undo2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const TOOLS = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'rect', label: 'Box' },
  { value: 'ellipse', label: 'Circle' },
  { value: 'text', label: 'Text' },
  { value: 'marker', label: 'Number' },
];

const drawShape = (context, item) => {
  context.save();
  context.strokeStyle = item.colour;
  context.fillStyle = item.colour;
  context.lineWidth = item.width;
  context.lineCap = 'round';
  const x1 = Math.min(item.x1, item.x2);
  const y1 = Math.min(item.y1, item.y2);
  const w = Math.abs(item.x2 - item.x1);
  const h = Math.abs(item.y2 - item.y1);

  if (item.type === 'arrow') {
    context.beginPath();
    context.moveTo(item.x1, item.y1);
    context.lineTo(item.x2, item.y2);
    context.stroke();
    const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
    const size = Math.max(10, item.width * 3);
    context.beginPath();
    context.moveTo(item.x2, item.y2);
    context.lineTo(item.x2 - size * Math.cos(angle - Math.PI / 7), item.y2 - size * Math.sin(angle - Math.PI / 7));
    context.lineTo(item.x2 - size * Math.cos(angle + Math.PI / 7), item.y2 - size * Math.sin(angle + Math.PI / 7));
    context.closePath();
    context.fill();
  } else if (item.type === 'rect') {
    context.strokeRect(x1, y1, w, h);
  } else if (item.type === 'ellipse') {
    context.beginPath();
    context.ellipse(x1 + w / 2, y1 + h / 2, Math.max(w / 2, 2), Math.max(h / 2, 2), 0, 0, Math.PI * 2);
    context.stroke();
  } else if (item.type === 'text') {
    const fontSize = Math.max(16, item.width * 5);
    context.font = '600 ' + fontSize + 'px Inter, system-ui, sans-serif';
    const text = item.text || 'Note';
    const width = context.measureText(text).width;
    context.fillStyle = 'rgba(2, 6, 23, 0.72)';
    context.fillRect(item.x1 - 8, item.y1 - fontSize, width + 16, fontSize * 1.35);
    context.fillStyle = item.colour;
    context.fillText(text, item.x1, item.y1);
  } else if (item.type === 'marker') {
    const radius = Math.max(14, item.width * 4);
    context.beginPath();
    context.arc(item.x1, item.y1, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#04121b';
    context.font = '700 ' + Math.round(radius * 1.1) + 'px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(item.text || '1'), item.x1, item.y1 + 1);
  }
  context.restore();
};

export default function ImageAnnotate() {
  const [image, setImage] = useState(null);
  const [items, setItems] = useState([]);
  const [tool, setTool] = useState('arrow');
  const [colour, setColour] = useState('#22d3ee');
  const [width, setWidth] = useState('5');
  const [text, setText] = useState('Look here');
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const itemsRef = useRef([]);

  useEffect(() => { itemsRef.current = items; }, [items]);

  const draw = useCallback((extra) => {
    const canvas = canvasRef.current;
    const picture = imageRef.current;
    if (!canvas || !picture) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    [...itemsRef.current, extra].filter(Boolean).forEach((item) => drawShape(context, item));
  }, []);

  useEffect(() => { draw(); }, [items, draw]);

  const pick = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result);
      const picture = new Image();
      picture.onload = () => {
        imageRef.current = picture;
        setImage({ src: source, width: picture.naturalWidth, height: picture.naturalHeight });
        setItems([]);
      };
      picture.src = source;
    };
    reader.readAsDataURL(file);
  };

  const position = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event) => {
    if (!image) return;
    const point = position(event);
    const stroke = Number(width) || 5;
    if (tool === 'text' || tool === 'marker') {
      const markerCount = items.filter((item) => item.type === 'marker').length + 1;
      setItems((current) => [...current, {
        id: Math.random().toString(36).slice(2),
        type: tool,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        colour,
        width: stroke,
        text: tool === 'marker' ? markerCount : text,
      }]);
      return;
    }
    dragRef.current = { id: Math.random().toString(36).slice(2), type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, colour, width: stroke, text: '' };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event) => {
    if (!dragRef.current) return;
    const point = position(event);
    dragRef.current = { ...dragRef.current, x2: point.x, y2: point.y };
    draw(dragRef.current);
  };

  const end = () => {
    if (!dragRef.current) return;
    const finished = dragRef.current;
    dragRef.current = null;
    setItems((current) => [...current, finished]);
  };

  const undo = () => setItems((current) => current.slice(0, -1));

  const exportPng = () => {
    const picture = imageRef.current;
    if (!picture) return;
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    items.forEach((item) => drawShape(context, item));
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'annotated.png';
    link.click();
  };

  const report = items.map((item, index) => (index + 1) + '. ' + item.type + (item.text ? ' "' + item.text + '"' : '')).join('\n');

  return (
    <ToolShell
      toolId="image-annotate"
      icon={PenTool}
      title="Image Annotator"
      desc="Draw arrows, boxes, circles, captions and numbered markers onto a screenshot and export it at full resolution — the picture never leaves your device."
      state={{ tool, colour, width, text }}
      onRestore={(restored) => {
        if (restored.tool) setTool(restored.tool);
        if (restored.colour) setColour(restored.colour);
        if (restored.width !== undefined) setWidth(String(restored.width));
        if (typeof restored.text === 'string') setText(restored.text);
      }}
      exportText={report}
      exportName="annotations.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Your screenshot</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files && e.target.files[0])}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-cyan-j/15 file:px-3 file:py-1.5 file:text-xs file:text-cyan-j"
          />
          <div className="mt-3 space-y-3">
            <Seg value={tool} onChange={setTool} options={TOOLS} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Colour">
                <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
              </Field>
              <Field label="Line weight">
                <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
            </div>
            <Field label="Caption text for the next label">
              <input value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={undo} disabled={!items.length} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
              <button type="button" onClick={() => setItems([])} disabled={!items.length} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-rose-300 disabled:opacity-40">
                Clear all
              </button>
              <button
                type="button"
                onClick={exportPng}
                disabled={!image}
                className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
              >
                Export annotated PNG
              </button>
            </div>
          </div>
        </Panel>

        <Panel className="!p-3">
          {image ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">Drag on the image to draw</span>
                <span className="font-mono-j text-[10px] text-muted-foreground">{image.width} × {image.height}</span>
              </div>
              <canvas
                ref={canvasRef}
                width={image.width}
                height={image.height}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className="w-full cursor-crosshair touch-none rounded-lg border border-border/60"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Arrows, boxes and circles are dragged out. Text and numbered markers are placed with a single click — markers number themselves in order.
              </p>
            </>
          ) : (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-border/70 text-center">
              <div>
                <PenTool className="mx-auto h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
                <p className="mt-2 text-[11px] text-muted-foreground">Choose a screenshot or photo to annotate</p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={items.length + ' annotation' + (items.length === 1 ? '' : 's') + ' placed'}
          value={String(items.length)}
          sub={'Exported at the image\'s own resolution' + (image ? ' (' + image.width + ' × ' + image.height + ')' : '') + ', not at the size it happens to be shown on screen — so arrows and text stay sharp.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Annotations, in order</div>
          {items.length ? (
            <div className="max-h-56 space-y-1 overflow-auto">
              {items.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.colour }} />
                  <span className="capitalize">{item.type}</span>
                  {item.text && <span className="truncate text-muted-foreground">{item.text}</span>}
                  <button
                    type="button"
                    onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground transition hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <span className="font-mono-j text-[10px] text-muted-foreground">{index + 1}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Nothing placed yet. Draw on the image and the list fills in.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Annotating well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· One arrow per point. A screen with twelve arrows says nothing; three well-placed ones carry an argument.</p>
            <p>· Numbered markers plus a short list underneath is the cleanest way to walk a reader through a busy interface.</p>
            <p>· Use a colour that does not already exist in the screenshot, or the annotation disappears into the picture.</p>
            <p>· Thicker lines for full-page screenshots, thinner ones for cropped detail — the weight should scale with the image, not with your monitor.</p>
            <p>· Put captions beside the thing, not on top of it. A label covering the control it describes defeats the point.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What happens to your image</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The picture is read with the browser's own file reader and drawn on a canvas — it is never uploaded and there is no server involved.</p>
            <p>· Both the preview and the export are drawn with the same shape code, so what you see is exactly what the PNG contains.</p>
            <p>· Coordinates are stored against the image's natural pixels, so annotations stay where you put them at any display size.</p>
            <p>· Exporting twice from different screen sizes produces identical files, because nothing depends on the window.</p>
            <p>· The annotation list copies as text, which is useful as a caption or a review note beside the image.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Annotations" value={String(items.length)} mono />
        <Stat label="Tool" value={tool} mono />
        <Stat label="Colour" value={colour} mono />
        <Stat label="Export" value={image ? image.width + 'w' : '—'} mono sub={image ? 'at full resolution' : 'no image yet'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where this is worth using</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Bug reports: circle the broken element, number the steps, and the developer stops guessing.</p>
          <p>· Design review: arrows on a build make the feedback specific instead of a paragraph of description.</p>
          <p>· Documentation: numbered callouts turn a screenshot into an explanation.</p>
          <p>· Teaching material: circle the error in a worked example and the lesson lands on the first read.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Items', value: String(items.length) },
              { label: 'Markers', value: String(items.filter((item) => item.type === 'marker').length) },
              { label: 'Captions', value: String(items.filter((item) => item.type === 'text').length) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every annotation is stored as a small record of coordinates and styling, and the canvas is redrawn from those records, so undo, delete and re-export all
          work without loss. The picture itself is only ever drawn, never modified.
        </p>
      </Panel>
    </ToolShell>
  );
}