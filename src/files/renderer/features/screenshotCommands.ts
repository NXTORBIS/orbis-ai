import type { Command } from '../commands';
import { call } from '../api';
import { openDialog, toast, toastError } from '../state/app';
import { openAnnotator, screenshot } from '../state/screenshot';
import type { CaptureResult, CaptureSource } from '../../shared/screenshot';

/**
 * Screenshot commands for the command palette, toolbar and keyboard shortcuts.
 * Capture runs in the main process; annotation is the renderer-side canvas.
 */

async function captureAndOpen(mode: 'fullscreen' | 'window' | 'region', sourceId?: string): Promise<void> {
  try {
    const result = await call<CaptureResult>('screenshot:capture', { mode, sourceId });
    openAnnotator(result);
  } catch (err) {
    toastError(err, 'Screenshot');
  }
}

export const SCREENSHOT_COMMANDS: Command[] = [
  {
    id: 'screenshot.fullscreen',
    title: 'Capture full screen',
    category: 'Tools',
    icon: 'camera',
    keys: ['Mod+Shift+3'],
    description: 'Takes a screenshot of the entire screen and opens it in the annotator for drawing, redacting and saving.',
    run: () => void captureAndOpen('fullscreen'),
  },
  {
    id: 'screenshot.window',
    title: 'Capture window…',
    category: 'Tools',
    icon: 'camera',
    keys: ['Mod+Shift+4'],
    description: 'Lists open windows and captures the one you pick into the annotator.',
    run: async () => {
      try {
        const sources = await call<CaptureSource[]>('screenshot:sources', { types: ['window'] });
        if (!sources.length) { toast({ level: 'info', title: 'No windows found.' }); return; }
        openDialog('screenshotSourcePicker', { sources });
      } catch (err) {
        toastError(err, 'Screenshot');
      }
    },
  },
  {
    id: 'screenshot.region',
    title: 'Capture region',
    category: 'Tools',
    icon: 'crop',
    keys: ['Mod+Shift+5'],
    description: 'Captures the full screen and opens the annotator with the crop tool active so you can select a region.',
    run: async () => {
      try {
        const result = await call<CaptureResult>('screenshot:capture', { mode: 'region' });
        openAnnotator(result);
        // Auto-select the crop tool so the user can draw a region.
        screenshot.set({ activeTool: 'crop' });
      } catch (err) {
        toastError(err, 'Screenshot');
      }
    },
  },
  {
    id: 'screenshot.annotate',
    title: 'Open image in annotator…',
    category: 'Tools',
    icon: 'pen',
    description: 'Opens the currently selected image file in the screenshot annotator for annotation.',
    when: (c) => {
      if (c.selection.length !== 1) return 'Select one image file.';
      const ext = c.selection[0]!.ext?.toLowerCase() ?? '';
      const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']);
      return imageExts.has(ext) ? true : 'Select an image file (PNG, JPEG, WebP, BMP or GIF).';
    },
    run: async (c) => {
      const path = c.selection[0]!.path;
      try {
        // Load the image via an <img> element to get dimensions.
        const img = new Image();
        const url = `orbis-media://thumb?path=${encodeURIComponent(path)}&size=0`;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = url;
        });

        // Capture by reading the image into a canvas to get base64.
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Cannot create canvas context');
        ctx.drawImage(img, 0, 0);

        const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        openAnnotator({ dataUrl: pngBase64, width: img.naturalWidth, height: img.naturalHeight });
      } catch (err) {
        toastError(err, 'Open in annotator');
      }
    },
  },
];
