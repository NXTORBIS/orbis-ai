import { EventEmitter } from 'node:events';
import type { AppDatabase } from './Database';
import { DEFAULT_SETTINGS, SettingsSchema, validateSettings, validateSettingValue, type SettingKey, type Settings } from '../../shared/settings';
import type { StartupNotice } from '../../shared/model';

/** Persistent settings, validated per key at load and on every write. */
export class SettingsStore extends EventEmitter {
  private current: Settings;
  readonly notices: StartupNotice[] = [];

  constructor(private readonly db: AppDatabase) {
    super();
    const rows = db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const raw: Record<string, unknown> = {};
    const unparsable: string[] = [];
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        unparsable.push(r.key);
      }
    }
    const { settings, invalid, unknown } = validateSettings(raw);
    this.current = settings;
    const bad = [...invalid, ...unparsable];
    if (bad.length) {
      this.notices.push({
        level: 'warning',
        message: `Some saved preferences were invalid and use their defaults: ${bad.join(', ')}.`,
      });
    }
    // Obsolete keys are dropped deliberately (migration of settings): they have no effect.
    for (const k of unknown) db.run('DELETE FROM settings WHERE key = ?', [k]);
  }

  all(): Settings {
    return structuredClone(this.current);
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    return this.current[key];
  }

  set(key: string, value: unknown): Settings {
    if (!(key in SettingsSchema.shape)) throw new Error(`Unknown setting "${key}"`);
    const k = key as SettingKey;
    const parsed = validateSettingValue(k, value);
    (this.current as Record<string, unknown>)[k] = parsed;
    this.db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(parsed)]);
    this.emit('changed', this.all());
    return this.all();
  }

  reset(key: string): Settings {
    if (!(key in SettingsSchema.shape)) throw new Error(`Unknown setting "${key}"`);
    const k = key as SettingKey;
    (this.current as Record<string, unknown>)[k] = structuredClone(DEFAULT_SETTINGS[k]);
    this.db.run('DELETE FROM settings WHERE key = ?', [k]);
    this.emit('changed', this.all());
    return this.all();
  }
}
