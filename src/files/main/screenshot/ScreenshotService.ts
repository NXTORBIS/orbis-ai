import { BrowserWindow, desktopCapturer, nativeImage, screen } from 'electron';
import type { CaptureRequest, CaptureResult, CaptureSource } from '../../shared/screenshot';

/**
 * Captures screenshots using Electron's desktopCapturer and nativeImage.
 * Supports full screen, window and region capture. Region capture uses a
 * transparent overlay window that the user draws on; the coordinates come
 * back from the renderer and the image is cropped here.
 */
export class ScreenshotService {
  /** Capture a screenshot according to the given request. */
  async capture(request: CaptureRequest): Promise<CaptureResult> {
    switch (request.mode) {
      case 'fullscreen':
        return this.captureFullScreen();
      case 'window':
        return this.captureWindow(request.sourceId);
      case 'region':
        return this.captureRegion(request.region);
      default:
        throw new Error(`Unknown capture mode: ${(request as CaptureRequest).mode}`);
    }
  }

  /** List available capture sources (screens and/or windows). */
  async listSources(types: Array<'screen' | 'window'>): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  }

  private async captureFullScreen(): Promise<CaptureResult> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scaleFactor),
        height: Math.round(height * scaleFactor),
      },
    });

    if (!sources.length) throw new Error('No screen sources available for capture.');

    // Use the primary display source (first screen).
    const source = sources[0]!;
    const img = source.thumbnail;

    if (img.isEmpty()) throw new Error('Captured image is empty.');

    const size = img.getSize();
    return {
      dataUrl: img.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
    };
  }

  private async captureWindow(sourceId?: string): Promise<CaptureResult> {
    if (!sourceId) throw new Error('sourceId is required for window capture.');

    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 3840, height: 2160 },
    });

    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Window source "${sourceId}" not found.`);

    const img = source.thumbnail;
    if (img.isEmpty()) throw new Error('Captured window image is empty.');

    const size = img.getSize();
    return {
      dataUrl: img.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
    };
  }

  private async captureRegion(region?: { x: number; y: number; width: number; height: number }): Promise<CaptureResult> {
    // Capture the full screen first, then crop to the region.
    const full = await this.captureFullScreen();

    if (!region) {
      // No region specified yet - return the full screen for the overlay to select on.
      return full;
    }

    // Crop the full-screen capture to the requested region.
    const fullBuf = Buffer.from(full.dataUrl, 'base64');
    const fullImg = nativeImage.createFromBuffer(fullBuf);
    const cropped = fullImg.crop({
      x: Math.max(0, region.x),
      y: Math.max(0, region.y),
      width: Math.min(region.width, full.width - region.x),
      height: Math.min(region.height, full.height - region.y),
    });

    if (cropped.isEmpty()) throw new Error('Cropped region is empty.');

    const size = cropped.getSize();
    return {
      dataUrl: cropped.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
    };
  }

  /** Create a transparent overlay window for region selection. */
  createRegionOverlay(parentBounds?: Electron.Rectangle): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const bounds = parentBounds ?? display.bounds;

    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      fullscreen: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    overlay.setIgnoreMouseEvents(false);

    // Load inline HTML for the region selector.
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 100%; height: 100%; overflow: hidden; cursor: crosshair; background: rgba(0,0,0,0.3); }
          #canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <canvas id="canvas"></canvas>
        <script>
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = window.innerWidth * devicePixelRatio;
          canvas.height = window.innerHeight * devicePixelRatio;
          canvas.style.width = window.innerWidth + 'px';
          canvas.style.height = window.innerHeight + 'px';
          ctx.scale(devicePixelRatio, devicePixelRatio);

          let start = null;
          let rect = null;

          function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
            if (rect) {
              ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
              ctx.strokeStyle = '#007AFF';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 3]);
              ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
              ctx.setLineDash([]);
              // Show dimensions.
              const label = Math.round(rect.w * devicePixelRatio) + ' x ' + Math.round(rect.h * devicePixelRatio);
              ctx.fillStyle = 'rgba(0, 122, 255, 0.85)';
              const lx = rect.x + rect.w / 2;
              const ly = rect.y + rect.h + 24;
              ctx.font = '13px system-ui, sans-serif';
              const tw = ctx.measureText(label).width;
              ctx.fillRect(lx - tw / 2 - 6, ly - 14, tw + 12, 20);
              ctx.fillStyle = '#fff';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, lx, ly - 4);
            }
          }

          canvas.addEventListener('mousedown', (e) => {
            start = { x: e.clientX, y: e.clientY };
          });
          canvas.addEventListener('mousemove', (e) => {
            if (!start) return;
            const x = Math.min(start.x, e.clientX);
            const y = Math.min(start.y, e.clientY);
            const w = Math.abs(e.clientX - start.x);
            const h = Math.abs(e.clientY - start.y);
            rect = { x, y, w, h };
            draw();
          });
          canvas.addEventListener('mouseup', () => {
            if (!rect || rect.w < 4 || rect.h < 4) { start = null; rect = null; draw(); return; }
            const region = {
              x: Math.round(rect.x * devicePixelRatio),
              y: Math.round(rect.y * devicePixelRatio),
              width: Math.round(rect.w * devicePixelRatio),
              height: Math.round(rect.h * devicePixelRatio),
            };
            // Post the result back via the page title.
            document.title = 'REGION:' + JSON.stringify(region);
            window.close();
          });
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.close();
          });
          draw();
        </script>
      </body>
      </html>
    `;

    overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return overlay;
  }
}
