import { createStore } from './store';
import { call } from '../api';
import type { Space } from '../../shared/spaces';

export interface SpacesState {
  spaces: Space[];
  activeSpaceId: string | null;
  loaded: boolean;
}

export const spaces = createStore<SpacesState>({
  spaces: [],
  activeSpaceId: null,
  loaded: false,
});

export async function loadSpaces(): Promise<void> {
  const list = await call('space:list') as Space[];
  spaces.set({ spaces: list, loaded: true });
}

export async function createSpace(name: string, folders: string[]): Promise<Space> {
  const space = await call('space:create', { name, folders }) as Space;
  await loadSpaces();
  return space;
}

export async function updateSpace(id: string, updates: { name?: string; folders?: string[]; sortKey?: string; sortDir?: 'asc' | 'desc'; viewMode?: string; tabState?: string }): Promise<void> {
  await call('space:update', { id, ...updates });
  await loadSpaces();
}

export async function deleteSpace(id: string): Promise<void> {
  await call('space:delete', { id });
  const st = spaces.get();
  if (st.activeSpaceId === id) {
    spaces.set({ activeSpaceId: st.spaces.find((s) => s.id !== id)?.id ?? null });
  }
  await loadSpaces();
}

export function setActiveSpace(id: string | null): void {
  spaces.set({ activeSpaceId: id });
}
