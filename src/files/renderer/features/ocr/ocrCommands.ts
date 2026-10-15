import type { Command, CommandContext } from '../../commands';
import { openDialog } from '../../state/app';
import { navigate, parentPath } from '../../state/workspace';
import { recognizeEntry } from '../../state/ocr';
import { ocrKindOf } from '../../../shared/ocr';
import { isRemoteRef } from '../../../shared/remote';
import type { FileEntry } from '../../../shared/model';

/**
 * Text recognition commands (registered with the others in commands.ts, so menus,
 * the palette, the toolbar and shortcuts all run these).
 */

const isOcrFile = (e: FileEntry) => (e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file')) && !!ocrKindOf(e.name) && !isRemoteRef(e.path);
const isFolder = (e: FileEntry) => e.kind === 'directory' && !isRemoteRef(e.path);

export const ocrRecognizeWhen = (c: CommandContext): boolean | string => {
  if (c.selection.length !== 1) return 'Select one image or PDF.';
  const e = c.selection[0]!;
  if (isRemoteRef(e.path)) return 'Download the file first; text is recognized in files on this computer.';
  return isOcrFile(e) ? true : 'Text can be recognized in PNG, JPEG, WebP, BMP, GIF, TIFF and PDF files.';
};

export const ocrExtractWhen = (c: CommandContext): boolean | string => {
  if (!c.selection.length) return c.dir ? true : 'Open a folder or select images, PDFs or folders.';
  if (c.selection.some((e) => isRemoteRef(e.path))) return 'Only files on this computer can be recognized.';
  return c.selection.every((e) => isOcrFile(e) || isFolder(e)) ? true : 'Select only images, PDFs and folders.';
};

export const OCR_COMMANDS: Command[] = [
  {
    id: 'ocr.recognize', title: 'Recognize text (OCR)', category: 'File', icon: 'ocr', keys: ['Mod+Shift+O'],
    description: 'Reads the text in the selected image or PDF on this computer (nothing is uploaded) and shows it in the details panel with its confidence, word boxes over the picture, Copy and Save as .txt. Scanned PDF pages are rendered first; pages that already have text use it.',
    when: ocrRecognizeWhen,
    run: (c) => void recognizeEntry(c.selection[0]!),
  },
  {
    id: 'ocr.extract', title: 'Extract text to files…', category: 'File', icon: 'ocrExtract',
    description: 'Recognizes the text of the selected images and PDFs (or of those in the selected folders, or in the folder shown) and saves it as a .txt next to each file or as one Markdown file, optionally with searchable PDF copies. Runs as an operation you can pause, cancel and undo.',
    when: ocrExtractWhen,
    run: (c) => {
      const paths = c.selection.length ? c.selection.map((e) => e.path) : [c.dir!];
      const dir = c.dir ?? parentPath(paths[0]!) ?? paths[0]!;
      openDialog('ocrExtract', { paths, dir, folders: c.selection.length ? c.selection.filter(isFolder).length : 1 });
    },
  },
  {
    id: 'ocr.settings', title: 'Text recognition settings', category: 'Tools', icon: 'languages',
    description: 'Languages for text recognition (add .traineddata files you have) and “Make text in images searchable”.',
    run: (c) => {
      void navigate(c.pane.id, { kind: 'tool', tool: 'settings' }).then(() => {
        const go = (n: number) => {
          const el = document.getElementById('settings-ocr');
          if (el) {
            el.scrollIntoView({ block: 'start' });
            el.querySelector<HTMLElement>('h2')?.focus();
          } else if (n > 0) setTimeout(() => go(n - 1), 100);
        };
        go(20);
      });
    },
  },
];
