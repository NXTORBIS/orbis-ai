import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import { EmptyState, IconButton } from '../../ui/components';
import { toast, toastError } from '../../state/app';
import { formatBytes } from '../../ui/format';
import type { ImageCropRotateResult, ImageDimensions, AspectRatio } from '../../../shared/imageCropRotate';
import { ASPECT_RATIOS } from '../../../shared/imageCropRotate';

interface CropRect { x: number; y: number; width: number; height: number }

export function ImageCropRotateView() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dims, setDims] = useState<ImageDimensions | null>(null);
  const [loading, setLoading] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [rotateDeg, setRotateDeg] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>('free');
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragging = useRef<{ handle: string; startX: number; startY: number; startCrop: CropRect } | null>(null);

  const pickFile = useCallback(async () => {
    try {
      const result = await call<{ path: string } | null>('fs:pickFile', { title: 'Choose an image to edit' });
      if (!result) return;
      const p = (result as { path: string }).path;
      setLoading(true);
      const info = await call<ImageDimensions>('imageCrop:info', { path: p });
      setFilePath(p);
      setDims(info);
      setCrop(null);
      setRotateDeg(0);
      setFlipH(false);
      setFlipV(false);
      setAspect('free');
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  // Draw image on canvas
  useEffect(() => {
    if (!filePath || !dims) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      drawCanvas();
    };
    // Use the file protocol for local images
    img.src = `orbis-media://${filePath}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, dims]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { drawCanvas(); }, [crop, rotateDeg, flipH, flipV]);

  function drawCanvas() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !dims) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxW = canvas.parentElement?.clientWidth ?? 600;
    const maxH = 500;
    const scale = Math.min(1, maxW / dims.width, maxH / dims.height);
    canvas.width = dims.width * scale;
    canvas.height = dims.height * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (flipH) ctx.scale(-1, 1);
    if (flipV) ctx.scale(1, -1);
    ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
    ctx.restore();

    // Draw crop overlay
    if (crop) {
      const cx = crop.x * scale;
      const cy = crop.y * scale;
      const cw = crop.width * scale;
      const ch = crop.height * scale;

      // Dim outside area
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, cy);
      ctx.fillRect(0, cy + ch, canvas.width, canvas.height - cy - ch);
      ctx.fillRect(0, cy, cx, ch);
      ctx.fillRect(cx + cw, cy, canvas.width - cx - cw, ch);

      // Crop border
      ctx.strokeStyle = 'var(--accent, #3b82f6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, cw, ch);

      // Corner handles
      const hs = 8;
      ctx.fillStyle = 'var(--accent, #3b82f6)';
      for (const corner of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
        ctx.fillRect(corner[0]! - hs / 2, corner[1]! - hs / 2, hs, hs);
      }
    }
  }

  function initCrop() {
    if (!dims) return;
    const r = ASPECT_RATIOS[aspect];
    let w = Math.floor(dims.width * 0.8);
    let h = Math.floor(dims.height * 0.8);
    if (r !== null) {
      if (w / h > r) w = Math.floor(h * r);
      else h = Math.floor(w / r);
    }
    const x = Math.floor((dims.width - w) / 2);
    const y = Math.floor((dims.height - h) / 2);
    setCrop({ x, y, width: w, height: h });
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!crop || !dims || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = canvasRef.current.width / dims.width;
    const mx = (e.clientX - rect.left) / scale;
    const my = (e.clientY - rect.top) / scale;

    const hs = 12 / scale;
    const corners: Array<[string, number, number]> = [
      ['nw', crop.x, crop.y],
      ['ne', crop.x + crop.width, crop.y],
      ['sw', crop.x, crop.y + crop.height],
      ['se', crop.x + crop.width, crop.y + crop.height],
    ];
    for (const [handle, cx, cy] of corners) {
      if (Math.abs(mx - cx) < hs && Math.abs(my - cy) < hs) {
        dragging.current = { handle, startX: mx, startY: my, startCrop: { ...crop } };
        return;
      }
    }
    if (mx >= crop.x && mx <= crop.x + crop.width && my >= crop.y && my <= crop.y + crop.height) {
      dragging.current = { handle: 'move', startX: mx, startY: my, startCrop: { ...crop } };
    }
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging.current || !dims || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = canvasRef.current.width / dims.width;
    const mx = (e.clientX - rect.left) / scale;
    const my = (e.clientY - rect.top) / scale;
    const dx = mx - dragging.current.startX;
    const dy = my - dragging.current.startY;
    const sc = dragging.current.startCrop;

    let next: CropRect;
    if (dragging.current.handle === 'move') {
      next = { ...sc, x: Math.max(0, Math.min(dims.width - sc.width, sc.x + dx)), y: Math.max(0, Math.min(dims.height - sc.height, sc.y + dy)) };
    } else {
      const h = dragging.current.handle;
      let nx = sc.x, ny = sc.y, nw = sc.width, nh = sc.height;
      if (h.includes('w')) { nx = Math.max(0, sc.x + dx); nw = sc.width - (nx - sc.x); }
      if (h.includes('e')) { nw = Math.min(dims.width - sc.x, sc.width + dx); }
      if (h.includes('n')) { ny = Math.max(0, sc.y + dy); nh = sc.height - (ny - sc.y); }
      if (h.includes('s')) { nh = Math.min(dims.height - sc.y, sc.height + dy); }
      if (nw < 10) nw = 10;
      if (nh < 10) nh = 10;
      const r = ASPECT_RATIOS[aspect];
      if (r !== null) { nh = Math.floor(nw / r); }
      next = { x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) };
    }
    setCrop(next);
  }

  function handleCanvasMouseUp() { dragging.current = null; }

  const rotate90 = (dir: 1 | -1) => setRotateDeg((d) => (d + dir * 90 + 360) % 360);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    setSaving(true);
    try {
      const result = await call<ImageCropRotateResult>('imageCrop:apply', {
        path: filePath,
        crop: crop ?? undefined,
        rotateDeg,
        flipH,
        flipV,
      });
      toast({ level: 'success', title: `Saved as ${result.outputPath.split('/').pop()}`, detail: `${result.width} x ${result.height} — ${formatBytes(result.bytes)}` });
    } catch (e) { toastError(e); }
    setSaving(false);
  }, [filePath, crop, rotateDeg, flipH, flipV]);

  if (!filePath) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Image Crop & Rotate</h1></header>
        {loading ? <div className="pad"><p className="muted">Loading image...</p></div> : (
          <EmptyState icon="image" title="No image selected" body="Choose an image to crop, rotate or flip.">
            <button type="button" className="btn btn-accent" onClick={pickFile}>Choose image</button>
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y image-crop-rotate">
      <header className="view-header">
        <h1>Image Crop & Rotate</h1>
        <div className="tb-group">
          <IconButton icon="open" label="Choose another image" onClick={pickFile} />
        </div>
      </header>

      <div className="icr-workspace pad">
        <div className="icr-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="icr-canvas"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          />
        </div>

        <div className="icr-controls">
          <div className="icr-section">
            <h3>Crop</h3>
            <div className="icr-row">
              <button type="button" className="btn btn-xs btn-default" onClick={initCrop}>
                {crop ? 'Reset crop' : 'Start crop'}
              </button>
              {crop && <button type="button" className="btn btn-xs btn-ghost" onClick={() => setCrop(null)}>Clear crop</button>}
            </div>
            <div className="icr-row">
              <label className="field-label">Aspect ratio</label>
              <select className="input input-sm" value={aspect} onChange={(e) => { setAspect(e.target.value as AspectRatio); }}>
                {Object.keys(ASPECT_RATIOS).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {crop && (
              <div className="icr-crop-info muted">
                {crop.width} x {crop.height} at ({crop.x}, {crop.y})
              </div>
            )}
          </div>

          <div className="icr-section">
            <h3>Rotate</h3>
            <div className="icr-row">
              <IconButton icon="back" label="Rotate 90 left" onClick={() => rotate90(-1)} />
              <IconButton icon="forward" label="Rotate 90 right" onClick={() => rotate90(1)} />
              <span className="muted">{rotateDeg}deg</span>
            </div>
            <div className="icr-row">
              <label className="field-label">Free rotation</label>
              <input type="range" min="-180" max="180" value={rotateDeg} onChange={(e) => setRotateDeg(Number(e.target.value))} className="icr-slider" />
            </div>
          </div>

          <div className="icr-section">
            <h3>Flip</h3>
            <div className="icr-row">
              <button type="button" className={`btn btn-xs ${flipH ? 'btn-default' : 'btn-ghost'}`} onClick={() => setFlipH(!flipH)}>Flip horizontal</button>
              <button type="button" className={`btn btn-xs ${flipV ? 'btn-default' : 'btn-ghost'}`} onClick={() => setFlipV(!flipV)}>Flip vertical</button>
            </div>
          </div>

          <div className="icr-section">
            <div className="icr-row">
              <button type="button" className="btn btn-accent" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving...' : 'Save as new file'}
              </button>
            </div>
            {dims && <p className="muted">Original: {dims.width} x {dims.height} ({dims.format})</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
