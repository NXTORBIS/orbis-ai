import { useSyncExternalStore, useRef } from 'react';

/** Minimal external store with selector subscriptions (no extra dependency). */
export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((s: T) => Partial<T>)): void;
  replace(next: T): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    replace(next) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Subscribe to a derived slice; re-renders only when the slice changes (shallow). */
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  const cache = useRef<{ value: S } | undefined>(undefined);
  const get = () => {
    const next = selector(store.get());
    if (cache.current && shallowEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
