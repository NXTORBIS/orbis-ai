import { useCallback, useSyncExternalStore } from 'react';
import { base44 } from '../api/base44Client.js';

const DEFAULTS = {
  name: 'Commander',
  theme: 'dark',
  accent: 'cyan',
  accentColor: '',
  onboarded: false,
  sidebarMode: 'expanded',
  searchEngine: 'google',
  customSearchUrl: '',
  assistant: 'jarvis',
  speakOnLoad: false,
  speechEnabled: true,
  autoRead: false,
  language: 'en-US',
  voiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  favoriteElements: [],
  // AI customization
  aiTemperature: 0.7,
  aiResponseLength: 'medium',
  aiTone: 'neutral',
  aiCustomPrompt: '',
  aiUseMarkdown: true,
  aiUseEmojis: false,
  aiProactive: true,
};

// Module-level shared store so every useSettings() caller reads the same state.
let state = { ...DEFAULTS };
let loaded = false;
let started = false;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function ensureLoad() {
  if (started) return;
  started = true;
  base44.auth.me()
    .then((u) => { if (u) state = { ...DEFAULTS, ...(u.settings || {}) }; })
    .catch(() => {})
    .finally(() => { loaded = true; emit(); });
}

function subscribe(l) {
  listeners.add(l);
  ensureLoad();
  return () => listeners.delete(l);
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, () => state);
  const update = useCallback((patch) => {
    state = { ...state, ...patch };
    emit();
    base44.auth.updateMe({ settings: state }).catch(() => {});
  }, []);
  return { settings, update, loaded };
}