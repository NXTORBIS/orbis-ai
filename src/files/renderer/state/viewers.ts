import { createStore } from './store';
import type { EbookManifest, ComicManifest, Model3DInfo } from '../../shared/viewers';

/* ---------------------------------------------------------------- E-book viewer state */

export interface EbookViewerState {
  open: {
    path: string;
    manifest: EbookManifest;
    chapterIndex: number;
    fontSize: number;
    darkMode: boolean;
    scrollOffset: number;
  } | null;
}

export const ebookViewer = createStore<EbookViewerState>({ open: null });

export function openEbook(path: string, manifest: EbookManifest, startIndex = 0): void {
  ebookViewer.set({
    open: {
      path,
      manifest,
      chapterIndex: startIndex,
      fontSize: 18,
      darkMode: false,
      scrollOffset: 0,
    },
  });
}

export function closeEbook(): void {
  ebookViewer.set({ open: null });
}

export function setEbookChapter(index: number): void {
  const o = ebookViewer.get().open;
  if (o) ebookViewer.set({ open: { ...o, chapterIndex: index, scrollOffset: 0 } });
}

export function setEbookFontSize(size: number): void {
  const o = ebookViewer.get().open;
  if (o) ebookViewer.set({ open: { ...o, fontSize: size } });
}

export function toggleEbookDarkMode(): void {
  const o = ebookViewer.get().open;
  if (o) ebookViewer.set({ open: { ...o, darkMode: !o.darkMode } });
}

/* ---------------------------------------------------------------- Comic viewer state */

export interface ComicViewerState {
  open: {
    path: string;
    manifest: ComicManifest;
    pageIndex: number;
    fitMode: 'width' | 'height' | 'page';
    doublePage: boolean;
    mangaMode: boolean;
    showThumbnails: boolean;
  } | null;
}

export const comicViewer = createStore<ComicViewerState>({ open: null });

export function openComic(path: string, manifest: ComicManifest, startIndex = 0): void {
  comicViewer.set({
    open: {
      path,
      manifest,
      pageIndex: startIndex,
      fitMode: 'width',
      doublePage: false,
      mangaMode: false,
      showThumbnails: false,
    },
  });
}

export function closeComic(): void {
  comicViewer.set({ open: null });
}

export function setComicPage(index: number): void {
  const o = comicViewer.get().open;
  if (o) {
    const clamped = Math.max(0, Math.min(o.manifest.pageCount - 1, index));
    comicViewer.set({ open: { ...o, pageIndex: clamped } });
  }
}

export function toggleComicDoublePage(): void {
  const o = comicViewer.get().open;
  if (o) comicViewer.set({ open: { ...o, doublePage: !o.doublePage } });
}

export function toggleMangaMode(): void {
  const o = comicViewer.get().open;
  if (o) comicViewer.set({ open: { ...o, mangaMode: !o.mangaMode } });
}

export function toggleComicThumbnails(): void {
  const o = comicViewer.get().open;
  if (o) comicViewer.set({ open: { ...o, showThumbnails: !o.showThumbnails } });
}

export function setComicFitMode(mode: 'width' | 'height' | 'page'): void {
  const o = comicViewer.get().open;
  if (o) comicViewer.set({ open: { ...o, fitMode: mode } });
}

/* ---------------------------------------------------------------- 3D model viewer state */

export interface ModelViewerState {
  open: {
    path: string;
    info: Model3DInfo;
    wireframe: boolean;
    showGrid: boolean;
    showAxes: boolean;
    color: string;
    bgColor: string;
  } | null;
}

export const modelViewer = createStore<ModelViewerState>({ open: null });

export function openModel(path: string, info: Model3DInfo): void {
  modelViewer.set({
    open: {
      path,
      info,
      wireframe: false,
      showGrid: true,
      showAxes: false,
      color: 'var(--accent, #6699cc)',
      bgColor: 'var(--surface-secondary, #1a1a2e)',
    },
  });
}

export function closeModel(): void {
  modelViewer.set({ open: null });
}

export function toggleModelWireframe(): void {
  const o = modelViewer.get().open;
  if (o) modelViewer.set({ open: { ...o, wireframe: !o.wireframe } });
}

export function toggleModelGrid(): void {
  const o = modelViewer.get().open;
  if (o) modelViewer.set({ open: { ...o, showGrid: !o.showGrid } });
}

export function toggleModelAxes(): void {
  const o = modelViewer.get().open;
  if (o) modelViewer.set({ open: { ...o, showAxes: !o.showAxes } });
}

export function setModelColor(color: string): void {
  const o = modelViewer.get().open;
  if (o) modelViewer.set({ open: { ...o, color } });
}
