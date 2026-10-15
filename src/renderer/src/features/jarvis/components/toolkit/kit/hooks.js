import { useEffect, useCallback, useState } from 'react';

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full — the tool still works, it just will not remember */
  }
};

/** State that survives a reload, scoped to one tool. */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => readJson(key, initial));
  useEffect(() => { writeJson(key, value); }, [key, value]);
  return [value, setValue];
}

/** Recent states of one tool, newest first, capped so storage stays small. */
export function useToolHistory(key, limit = 10) {
  const storageKey = `${key}:history`;
  const [items, setItems] = useState(() => readJson(storageKey, []));

  const push = useCallback((entry) => {
    setItems((current) => {
      if (current.length && JSON.stringify(current[0].state) === JSON.stringify(entry.state)) return current;
      const next = [{ ...entry, at: Date.now() }, ...current].slice(0, limit);
      writeJson(storageKey, next);
      return next;
    });
  }, [storageKey, limit]);

  const clear = useCallback(() => {
    setItems([]);
    writeJson(storageKey, []);
  }, [storageKey]);

  return { items, push, clear };
}

/** Tools you starred, so the ones you actually use stay at the top of the toolkit. */
const PINS_KEY = 'toolkit:pins';

export function usePinnedTools() {
  const [pinned, setPinned] = useState(() => readJson(PINS_KEY, []));

  const write = useCallback((next) => {
    setPinned(next);
    writeJson(PINS_KEY, next);
    window.dispatchEvent(new Event('toolkit:pins'));
  }, []);

  useEffect(() => {
    const sync = () => setPinned(readJson(PINS_KEY, []));
    window.addEventListener('toolkit:pins', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('toolkit:pins', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const isPinned = useCallback((id) => pinned.includes(id), [pinned]);
  const toggle = useCallback((id) => {
    write(pinned.includes(id) ? pinned.filter((x) => x !== id) : [id, ...pinned].slice(0, 12));
  }, [pinned, write]);

  return { pinned, isPinned, toggle };
}

/** The tools you actually opened, newest first — a library you can walk back into. */
const RECENT_KEY = 'toolkit:recent';

export function useRecentTools(limit = 8) {
  const [recent, setRecent] = useState(() => readJson(RECENT_KEY, []));

  useEffect(() => {
    const sync = () => setRecent(readJson(RECENT_KEY, []));
    window.addEventListener('toolkit:recent', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('toolkit:recent', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const record = useCallback((id) => {
    if (!id) return;
    const next = [id, ...readJson(RECENT_KEY, []).filter((entry) => entry !== id)].slice(0, limit);
    writeJson(RECENT_KEY, next);
    window.dispatchEvent(new Event('toolkit:recent'));
  }, [limit]);

  return { recent, record };
}

export function encodeShareState(state) {
  try { return encodeURIComponent(JSON.stringify(state)); } catch { return ''; }
}

export function decodeShareState(raw) {
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return null; }
}

/** A link back to this tool, with the current setup baked in and the tool id carried. */
export function buildShareUrl(state, toolId) {
  try {
    const url = new URL(window.location.href);
    if (toolId) url.searchParams.set('tool', toolId);
    url.searchParams.set('s', encodeShareState(state));
    return url.toString();
  } catch {
    return window.location.href;
  }
}

export function readShareState() {
  try {
    const raw = new URLSearchParams(window.location.search).get('s');
    return raw ? decodeShareState(raw) : null;
  } catch {
    return null;
  }
}