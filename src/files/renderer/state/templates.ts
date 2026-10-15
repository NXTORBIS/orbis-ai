import { createStore } from './store';
import { call } from '../api';
import { app } from './app';

/**
 * File templates for New → (from the templates folder; see main/fs/templates.ts).
 * The list is read when Orbis Files starts, when the templates folder setting
 * changes, and again each time a New menu or the template chooser opens, so
 * files added to the folder appear without a restart.
 */
export interface TemplateInfo { name: string; path: string; size: number; ext: string }
export interface TemplatesListing { folder?: string; source: 'setting' | 'xdg' | 'none'; note?: string; templates: TemplateInfo[] }

export const templates = createStore<{ listing?: TemplatesListing; error?: string }>({});

let inflight: Promise<TemplatesListing | undefined> | undefined;
export function refreshTemplates(): Promise<TemplatesListing | undefined> {
  inflight ??= call<TemplatesListing>('fs:templates')
    .then((listing) => {
      templates.set({ listing, error: undefined });
      return listing;
    }, (err) => {
      templates.set({ error: (err as Error).message });
      return undefined;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

let lastFolder: string | undefined;
/** Keep the list in step with the templates folder setting. */
export function followTemplatesSetting(): void {
  lastFolder = app.get().settings.templatesFolder;
  void refreshTemplates();
  app.subscribe(() => {
    const f = app.get().settings.templatesFolder;
    if (f !== lastFolder) {
      lastFolder = f;
      void refreshTemplates();
    }
  });
}
