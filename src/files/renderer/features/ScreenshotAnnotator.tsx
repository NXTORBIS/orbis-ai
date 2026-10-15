import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  screenshot, closeAnnotator, addAnnotation, undo, redo, setTool, setColor,
  setZoom, setPan, setCropRegion,
} from '../state/screenshot';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import { Icon } from '../ui/Icon';
import type {
  Annotation, AnnotationTool, Point, ArrowAnnotation, TextAnnotation,
  RectAnnotation, CircleAnnotation, FreehandAnnotation, HighlighterAnnotation,
  RedactAnnotation, CropAnnotation,
} from '../../shared/screenshot';
import { ANNOTATION_COLORS } from '../../shared/screenshot';

let idSeq = 0;
function nextId(): string {
  return `ann-${Date.now().toString(36)}-${++idSeq}`;
}

// ---- Canvas rendering helpers ----

function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowAnnotation): void {
  const { start, end, color, lineWidth } = a;
  const headLen = Math.max(12, lineWidth * 4);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Arrowhead
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnnotation): void {
  ctx.fillStyle = a.color;
  ctx.font = `bold ${a.fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'top';

  // Draw with background for readability.
  const lines = a.text.split('\n');
  let y = a.position.y;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(a.position.x - 2, y - 2, metrics.width + 4, a.fontSize + 4);
    ctx.fillStyle = a.color;
    ctx.fillText(line, a.position.x, y);
    y += a.fontSize + 4;
  }
}

function drawRect(ctx: CanvasRenderingContext2D, a: RectAnnotation): void {
  const x = Math.min(a.start.x, a.end.x);
  const y = Math.min(a.start.y, a.end.y);
  const w = Math.abs(a.end.x - a.start.x);
  const h = Math.abs(a.end.y - a.start.y);

  if (a.filled) {
    ctx.fillStyle = a.color + '40'; // 25% opacity
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.lineWidth;
  ctx.strokeRect(x, y, w, h);
}

function drawCircle(ctx: CanvasRenderingContext2D, a: CircleAnnotation): void {
  ctx.beginPath();
  ctx.ellipse(a.center.x, a.center.y, a.radiusX, a.radiusY, 0, 0, Math.PI * 2);
  if (a.filled) {
    ctx.fillStyle = a.color + '40';
    ctx.fill();
  }
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.lineWidth;
  ctx.stroke();
}

function drawFreehand(ctx: CanvasRenderingContext2D, a: FreehandAnnotation): void {
  if (a.points.length < 2) return;
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.points[0]!.x, a.points[0]!.y);
  for (let i = 1; i < a.points.length; i++) {
    ctx.lineTo(a.points[i]!.x, a.points[i]!.y);
  }
  ctx.stroke();
}

function drawHighlighter(ctx: CanvasRenderingContext2D, a: HighlighterAnnotation): void {
  if (a.points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.lineWidth * 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.points[0]!.x, a.points[0]!.y);
  for (let i = 1; i < a.points.length; i++) {
    ctx.lineTo(a.points[i]!.x, a.points[i]!.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Redact: replaces pixels with a solid colour and random noise. This is
 * real pixel destruction -- the original data is gone and cannot be recovered.
 */
function drawRedact(ctx: CanvasRenderingContext2D, a: RedactAnnotation): void {
  const x = Math.min(a.start.x, a.end.x);
  const y = Math.min(a.start.y, a.end.y);
  const w = Math.abs(a.end.x - a.start.x);
  const h = Math.abs(a.end.y - a.start.y);
  if (w < 1 || h < 1) return;

  // Fill with solid dark colour first.
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, w, h);

  // Overlay with random pixel noise to destroy any trace of the original.
  const imgData = ctx.getImageData(x, y, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(Math.random() * 40) + 10;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, x, y);
}

function drawCropOverlay(ctx: CanvasRenderingContext2D, a: CropAnnotation, canvasW: number, canvasH: number): void {
  const x = Math.min(a.start.x, a.end.x);
  const y = Math.min(a.start.y, a.end.y);
  const w = Math.abs(a.end.x - a.start.x);
  const h = Math.abs(a.end.y - a.start.y);

  // Darken the area outside the crop.
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  // Top
  ctx.fillRect(0, 0, canvasW, y);
  // Bottom
  ctx.fillRect(0, y + h, canvasW, canvasH - y - h);
  // Left
  ctx.fillRect(0, y, x, h);
  // Right
  ctx.fillRect(x + w, y, canvasW - x - w, h);

  // Crop border
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Rule of thirds grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 3, y);
    ctx.lineTo(x + (w * i) / 3, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + (h * i) / 3);
    ctx.lineTo(x + w, y + (h * i) / 3);
    ctx.stroke();
  }

  // Dimensions label
  ctx.fillStyle = 'rgba(0, 122, 255, 0.85)';
  const label = `${Math.round(w)} x ${Math.round(h)}`;
  ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  const lx = x + w / 2;
  const ly = y + h + 20;
  ctx.fillRect(lx - tw / 2 - 4, ly - 10, tw + 8, 18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly - 1);
  ctx.restore();
}

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, canvasW: number, canvasH: number): void {
  switch (a.tool) {
    case 'arrow': drawArrow(ctx, a); break;
    case 'text': drawText(ctx, a); break;
    case 'rectangle': drawRect(ctx, a); break;
    case 'circle': drawCircle(ctx, a); break;
    case 'freehand': drawFreehand(ctx, a); break;
    case 'highlighter': drawHighlighter(ctx, a); break;
    case 'redact': drawRedact(ctx, a); break;
    case 'crop': drawCropOverlay(ctx, a, canvasW, canvasH); break;
  }
}

// ---- Tool definitions for the toolbar ----
interface ToolDef {
  id: AnnotationTool;
  label: string;
  icon: string;
  shortcut?: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: 'search', shortcut: 'V' },
  { id: 'arrow', label: 'Arrow', icon: 'forward', shortcut: 'A' },
  { id: 'text', label: 'Text', icon: 'type', shortcut: 'T' },
  { id: 'rectangle', label: 'Rectangle', icon: 'stop', shortcut: 'R' },
  { id: 'circle', label: 'Circle', icon: 'contrast', shortcut: 'C' },
  { id: 'freehand', label: 'Draw', icon: 'edit', shortcut: 'D' },
  { id: 'highlighter', label: 'Highlight', icon: 'cleanup', shortcut: 'H' },
  { id: 'redact', label: 'Redact', icon: 'eraser', shortcut: 'X' },
  { id: 'crop', label: 'Crop', icon: 'crop', shortcut: 'P' },
];

// ---- Main Component ----

export function ScreenshotAnnotator() {
  const state = useStore(screenshot, (s) => s);
  if (!state.open || !state.captured) return null;
  return <AnnotatorCanvas />;
}

function AnnotatorCanvas() {
  const state = useStore(screenshot, (s) => s);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [textInput, setTextInput] = useState<{ position: Point; visible: boolean }>({ position: { x: 0, y: 0 }, visible: false });
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  const { captured, annotations, activeTool, color, lineWidth, fontSize, zoom, panOffset, filled } = state;

  // Load the captured image.
  useEffect(() => {
    if (!captured) return;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      renderCanvas();
    };
    // The capture comes back as raw base64 PNG data.
    img.src = `data:image/png;base64,${captured.dataUrl}`;
  }, [captured]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when annotations or zoom change.
  useEffect(() => { renderCanvas(); }, [annotations, zoom, panOffset, drawing]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !captured) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to the image dimensions.
    canvas.width = captured.width;
    canvas.height = captured.height;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the base image.
    ctx.drawImage(img, 0, 0);

    // Draw all annotations.
    for (const ann of annotations) {
      drawAnnotation(ctx, ann, canvas.width, canvas.height);
    }

    // Draw current in-progress annotation.
    if (drawing && drawStart) {
      const currentEnd = currentPoints.length ? currentPoints[currentPoints.length - 1]! : drawStart;
      drawInProgress(ctx, activeTool, drawStart, currentEnd, currentPoints, canvas.width, canvas.height);
    }

    ctx.restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, captured, drawing, drawStart, currentPoints, activeTool, zoom, panOffset, color, lineWidth, fontSize, filled]);

  function drawInProgress(ctx: CanvasRenderingContext2D, tool: AnnotationTool, start: Point, end: Point, pts: Point[], cw: number, ch: number): void {
    switch (tool) {
      case 'arrow': drawArrow(ctx, { id: '', tool: 'arrow', start, end, color, lineWidth }); break;
      case 'rectangle': drawRect(ctx, { id: '', tool: 'rectangle', start, end, color, lineWidth, filled }); break;
      case 'circle': {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        drawCircle(ctx, { id: '', tool: 'circle', center: { x: cx, y: cy }, radiusX: Math.abs(end.x - start.x) / 2, radiusY: Math.abs(end.y - start.y) / 2, color, lineWidth, filled });
        break;
      }
      case 'freehand': if (pts.length > 1) drawFreehand(ctx, { id: '', tool: 'freehand', points: pts, color, lineWidth }); break;
      case 'highlighter': if (pts.length > 1) drawHighlighter(ctx, { id: '', tool: 'highlighter', points: pts, color, lineWidth }); break;
      case 'redact': drawRedact(ctx, { id: '', tool: 'redact', start, end, color, lineWidth }); break;
      case 'crop': drawCropOverlay(ctx, { id: '', tool: 'crop', start, end, color, lineWidth }, cw, ch); break;
    }
  }

  /** Convert mouse event coordinates to canvas coordinates (accounting for zoom and pan). */
  function toCanvasCoords(e: React.MouseEvent): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+click: start panning.
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    if (activeTool === 'select') return;

    if (activeTool === 'text') {
      const pos = toCanvasCoords(e);
      setTextInput({ position: pos, visible: true });
      setTextValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }

    const pos = toCanvasCoords(e);
    setDrawing(true);
    setDrawStart(pos);
    setCurrentPoints([pos]);
  }

  function handleMouseMove(e: React.MouseEvent): void {
    if (isPanning && panStart) {
      setPan(e.clientX - panStart.x, e.clientY - panStart.y);
      return;
    }

    if (!drawing || !drawStart) return;
    const pos = toCanvasCoords(e);

    if (activeTool === 'freehand' || activeTool === 'highlighter') {
      setCurrentPoints((prev) => [...prev, pos]);
    } else {
      setCurrentPoints([pos]);
    }
  }

  function handleMouseUp(e: React.MouseEvent): void {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (!drawing || !drawStart) return;
    const end = toCanvasCoords(e);

    const id = nextId();
    let annotation: Annotation | null = null;

    switch (activeTool) {
      case 'arrow':
        annotation = { id, tool: 'arrow', start: drawStart, end, color, lineWidth };
        break;
      case 'rectangle':
        annotation = { id, tool: 'rectangle', start: drawStart, end, color, lineWidth, filled };
        break;
      case 'circle': {
        const cx = (drawStart.x + end.x) / 2;
        const cy = (drawStart.y + end.y) / 2;
        annotation = { id, tool: 'circle', center: { x: cx, y: cy }, radiusX: Math.abs(end.x - drawStart.x) / 2, radiusY: Math.abs(end.y - drawStart.y) / 2, color, lineWidth, filled };
        break;
      }
      case 'freehand':
        if (currentPoints.length > 1) annotation = { id, tool: 'freehand', points: [...currentPoints, end], color, lineWidth };
        break;
      case 'highlighter':
        if (currentPoints.length > 1) annotation = { id, tool: 'highlighter', points: [...currentPoints, end], color, lineWidth };
        break;
      case 'redact':
        annotation = { id, tool: 'redact', start: drawStart, end, color, lineWidth };
        break;
      case 'crop': {
        const cx0 = Math.min(drawStart.x, end.x);
        const cy0 = Math.min(drawStart.y, end.y);
        const cw = Math.abs(end.x - drawStart.x);
        const ch = Math.abs(end.y - drawStart.y);
        if (cw > 4 && ch > 4) {
          setCropRegion({ x: Math.round(cx0), y: Math.round(cy0), width: Math.round(cw), height: Math.round(ch) });
          annotation = { id, tool: 'crop', start: drawStart, end, color, lineWidth };
        }
        break;
      }
    }

    if (annotation) addAnnotation(annotation);
    setDrawing(false);
    setDrawStart(null);
    setCurrentPoints([]);
  }

  function handleTextSubmit(): void {
    if (textValue.trim()) {
      addAnnotation({
        id: nextId(),
        tool: 'text',
        position: textInput.position,
        text: textValue,
        color,
        lineWidth,
        fontSize,
      });
    }
    setTextInput({ position: { x: 0, y: 0 }, visible: false });
    setTextValue('');
  }

  function handleWheel(e: React.WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(zoom + delta);
  }

  // Keyboard shortcuts.
  const textInputVisibleRef = useRef(textInput.visible);
  textInputVisibleRef.current = textInput.visible;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const handleTextSubmitRef = useRef(handleTextSubmit);
  handleTextSubmitRef.current = handleTextSubmit;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (textInputVisibleRef.current) {
        if (e.key === 'Escape') setTextInput({ position: { x: 0, y: 0 }, visible: false });
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSubmitRef.current(); }
        return;
      }

      if (e.key === 'Escape') { closeAnnotator(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { if (e.shiftKey) { redo(); } else { undo(); } return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void handleSaveRef.current(); return; }

      // Tool shortcuts (single letter, no modifiers).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        for (const t of TOOLS) {
          if (t.shortcut && e.key.toUpperCase() === t.shortcut) {
            setTool(t.id);
            return;
          }
        }
        if (e.key === '+' || e.key === '=') setZoom(zoomRef.current + 0.1);
        if (e.key === '-') setZoom(zoomRef.current - 0.1);
        if (e.key === '0') setZoom(1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Export the annotated canvas and save to a file. */
  async function handleSave(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas || !captured) return;

    // Render the final image at full resolution.
    const exportCanvas = document.createElement('canvas');
    const crop = screenshot.get().cropRegion;

    if (crop) {
      exportCanvas.width = crop.width;
      exportCanvas.height = crop.height;
    } else {
      exportCanvas.width = captured.width;
      exportCanvas.height = captured.height;
    }

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // Draw the base image.
    const img = imageRef.current;
    if (!img) return;

    if (crop) {
      ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    } else {
      ctx.drawImage(img, 0, 0);
    }

    // Re-draw all annotations (except crop overlays) onto the export canvas.
    if (crop) {
      ctx.translate(-crop.x, -crop.y);
    }
    for (const ann of annotations) {
      if (ann.tool === 'crop') continue; // Don't draw crop overlay on export.
      drawAnnotation(ctx, ann, captured.width, captured.height);
    }
    if (crop) {
      ctx.translate(crop.x, crop.y);
    }

    const dataUrl = exportCanvas.toDataURL('image/png');

    try {
      // Ask main process to show a save dialog.
      const dest = await call<string | null>('fs:pickFile', { title: 'Save screenshot' });
      if (!dest) return;

      // Ensure it has a .png extension.
      let savePath = dest;
      if (!savePath.toLowerCase().endsWith('.png') && !savePath.toLowerCase().endsWith('.jpg') && !savePath.toLowerCase().endsWith('.jpeg')) {
        savePath += '.png';
      }

      const format = savePath.toLowerCase().endsWith('.jpg') || savePath.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
      const quality = format === 'jpeg' ? 92 : 100;

      const finalDataUrl = format === 'jpeg' ? exportCanvas.toDataURL('image/jpeg', quality / 100) : dataUrl;

      await call('screenshot:save', {
        dataUrl: finalDataUrl,
        destination: savePath,
        format,
        quality,
      });

      toast({ level: 'success', title: `Screenshot saved to ${savePath.split('/').pop()}` });
    } catch (err) {
      toastError(err, 'Save screenshot');
    }
  }

  /** Copy the annotated image to clipboard. */
  async function handleCopy(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast({ level: 'success', title: 'Copied to clipboard' });
      }
    } catch {
      toastError(new Error('Failed to copy'), 'Copy screenshot');
    }
  }

  const cursorForTool = (t: AnnotationTool): string => {
    switch (t) {
      case 'select': return 'default';
      case 'text': return 'text';
      case 'crop': return 'crosshair';
      case 'redact': return 'crosshair';
      default: return 'crosshair';
    }
  };

  return (
    <div className="screenshot-overlay">
      {/* Toolbar */}
      <div className="screenshot-toolbar">
        <div className="screenshot-toolbar-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`screenshot-tool-btn${activeTool === t.id ? ' active' : ''}`}
              onClick={() => setTool(t.id)}
              title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
            >
              <Icon name={t.icon} />
            </button>
          ))}
        </div>

        <div className="screenshot-toolbar-sep" />

        {/* Colour picker */}
        <div className="screenshot-toolbar-group">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              className={`screenshot-color-btn${color === c ? ' active' : ''}`}
              style={{ backgroundColor: c, border: c === '#FFFFFF' ? '1px solid var(--border)' : undefined }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        <div className="screenshot-toolbar-sep" />

        {/* Line width */}
        <div className="screenshot-toolbar-group">
          <select
            className="screenshot-select"
            value={lineWidth}
            onChange={(e) => screenshot.set({ lineWidth: parseInt(e.target.value, 10) })}
          >
            <option value="1">Thin</option>
            <option value="2">Light</option>
            <option value="3">Medium</option>
            <option value="5">Thick</option>
            <option value="8">Heavy</option>
          </select>
        </div>

        <div className="screenshot-toolbar-sep" />

        {/* Fill toggle */}
        <div className="screenshot-toolbar-group">
          <button
            className={`screenshot-tool-btn${filled ? ' active' : ''}`}
            onClick={() => screenshot.set({ filled: !filled })}
            title="Fill shapes"
          >
            <Icon name="palette" />
          </button>
        </div>

        <div className="screenshot-toolbar-sep" />

        {/* Undo / Redo */}
        <div className="screenshot-toolbar-group">
          <button
            className="screenshot-tool-btn"
            onClick={undo}
            disabled={!state.undoStack.length}
            title="Undo (Ctrl+Z)"
          >
            <Icon name="undo" />
          </button>
          <button
            className="screenshot-tool-btn"
            onClick={redo}
            disabled={!state.redoStack.length}
            title="Redo (Ctrl+Y)"
          >
            <Icon name="redo" />
          </button>
        </div>

        <div className="screenshot-toolbar-sep" />

        {/* Zoom controls */}
        <div className="screenshot-toolbar-group">
          <button className="screenshot-tool-btn" onClick={() => setZoom(zoom - 0.1)} title="Zoom out (-)">
            <Icon name="zoomOut" />
          </button>
          <span className="screenshot-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="screenshot-tool-btn" onClick={() => setZoom(zoom + 0.1)} title="Zoom in (+)">
            <Icon name="zoomIn" />
          </button>
          <button className="screenshot-tool-btn" onClick={() => setZoom(1)} title="Reset zoom (0)">
            <Icon name="fitContent" />
          </button>
        </div>

        <div className="screenshot-toolbar-spacer" />

        {/* Actions */}
        <div className="screenshot-toolbar-group">
          <button className="screenshot-tool-btn" onClick={handleCopy} title="Copy to clipboard">
            <Icon name="clipboard" />
          </button>
          <button className="screenshot-action-btn" onClick={handleSave} title="Save (Ctrl+S)">
            <Icon name="save" /> Save
          </button>
          <button className="screenshot-tool-btn screenshot-close-btn" onClick={closeAnnotator} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        className="screenshot-canvas-container"
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className="screenshot-canvas"
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
            cursor: isPanning ? 'grabbing' : cursorForTool(activeTool),
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (drawing) {
              setDrawing(false);
              setDrawStart(null);
              setCurrentPoints([]);
            }
          }}
        />

        {/* Text input overlay */}
        {textInput.visible && (
          <div
            className="screenshot-text-input-container"
            style={{
              left: textInput.position.x * zoom + panOffset.x,
              top: textInput.position.y * zoom + panOffset.y + 56, // 56px for toolbar
            }}
          >
            <textarea
              ref={textInputRef}
              className="screenshot-text-input"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSubmit();
                }
                if (e.key === 'Escape') {
                  setTextInput({ position: { x: 0, y: 0 }, visible: false });
                }
              }}
              placeholder="Type text..."
              style={{ color, fontSize: `${fontSize}px` }}
              autoFocus
            />
            <button className="screenshot-text-submit" onClick={handleTextSubmit}>
              <Icon name="check" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
