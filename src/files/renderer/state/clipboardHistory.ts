import { createStore } from './store';
import { call } from '../api';
import type { ClipHistoryItem } from '../../shared/clipboardHistory';

export interface ClipboardHistoryState {
  items: ClipHistoryItem[];
  loading: boolean;
  open: boolean;
}

export const clipboardHistory = createStore<ClipboardHistoryState>({
  items: [],
  loading: false,
  open: false,
});

export async function loadClipboardHistory(): Promise<void> {
  clipboardHistory.set({ ...clipboardHistory.get(), loading: true });
  try {
    const items = await call<ClipHistoryItem[]>('clipHistory:list');
    clipboardHistory.set({ ...clipboardHistory.get(), items, loading: false });
  } catch {
    clipboardHistory.set({ ...clipboardHistory.get(), loading: false });
  }
}

export async function captureClipboard(): Promise<void> {
  try {
    await call<ClipHistoryItem | null>('clipHistory:capture');
    await loadClipboardHistory();
  } catch {
    // ignore
  }
}

export async function recopyItem(id: string): Promise<void> {
  await call<{ ok: boolean }>('clipHistory:recopy', { id });
}

export async function pinItem(id: string): Promise<void> {
  await call<{ ok: boolean }>('clipHistory:pin', { id });
  await loadClipboardHistory();
}

export async function unpinItem(id: string): Promise<void> {
  await call<{ ok: boolean }>('clipHistory:unpin', { id });
  await loadClipboardHistory();
}

export async function removeItem(id: string): Promise<void> {
  await call<{ ok: boolean }>('clipHistory:remove', { id });
  await loadClipboardHistory();
}

export async function clearHistory(): Promise<void> {
  await call<{ ok: boolean; remaining: number }>('clipHistory:clear');
  await loadClipboardHistory();
}

export function toggleClipboardHistory(): void {
  const s = clipboardHistory.get();
  if (!s.open) void loadClipboardHistory();
  clipboardHistory.set({ ...s, open: !s.open });
}
