import { call } from '../api';
import type { Macro, MacroCreate, MacroUpdate } from '../../shared/macros';

export async function listMacros(): Promise<Macro[]> {
  return call<Macro[]>('macro:list');
}

export async function createMacro(data: MacroCreate): Promise<Macro> {
  return call<Macro>('macro:create', data);
}

export async function updateMacro(data: MacroUpdate): Promise<Macro> {
  return call<Macro>('macro:update', data);
}

export async function deleteMacro(id: string): Promise<void> {
  await call('macro:delete', { id });
}

export async function getMacro(id: string): Promise<Macro> {
  return call<Macro>('macro:get', { id });
}

export async function playbackMacro(id: string, targetDir: string): Promise<{ results: Array<{ step: number; status: 'ok' | 'error'; detail?: string }> }> {
  return call('macro:playback', { id, targetDir });
}
