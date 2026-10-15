import crypto from 'node:crypto';
import { z } from 'zod';
import { makeError } from '../../shared/errors';
import { RenamePresetSchema, type RenamePreset, type RenameSpecInput, RenameSpecSchema } from '../../shared/rename';

/**
 * Saved bulk-rename rule sets, stored per profile in the catalogue database
 * (key-value table). Stored values are validated on every read: a preset that
 * no longer validates is left out rather than breaking the dialog.
 */

const KEY = 'bulkRename.presets';
export const MAX_RENAME_PRESETS = 100;

export interface KvStore {
  getKv<T>(key: string, fallback: T): T;
  setKv(key: string, value: unknown): void;
}

export class RenamePresetStore {
  constructor(private readonly kv: KvStore) {}

  list(): RenamePreset[] {
    const raw = this.kv.getKv<unknown>(KEY, []);
    const arr = z.array(z.unknown()).safeParse(raw);
    if (!arr.success) return [];
    const out: RenamePreset[] = [];
    for (const item of arr.data) {
      const p = RenamePresetSchema.safeParse(item);
      if (p.success) out.push(p.data);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Save under a name; a preset with the same name (ignoring case) is replaced. */
  save(name: string, specInput: RenameSpecInput): RenamePreset {
    const n = name.trim();
    if (!n) throw makeError('validation', 'rename.savePreset', { message: 'Enter a name for the preset.' });
    const spec = RenameSpecSchema.safeParse(specInput);
    if (!spec.success) throw makeError('validation', 'rename.savePreset', { message: 'These rename rules are not valid.', cause: spec.error.issues[0]?.message });
    const list = this.list();
    const existing = list.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!existing && list.length >= MAX_RENAME_PRESETS) throw makeError('validation', 'rename.savePreset', { message: `Up to ${MAX_RENAME_PRESETS} presets can be saved. Delete one first.` });
    const preset: RenamePreset = { id: existing?.id ?? crypto.randomUUID(), name: n.slice(0, 80), spec: spec.data, savedMs: Date.now() };
    this.kv.setKv(KEY, [...list.filter((p) => p.id !== preset.id), preset]);
    return preset;
  }

  delete(id: string): boolean {
    const list = this.list();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    this.kv.setKv(KEY, next);
    return true;
  }
}
