/** Where saved work lives, in words, depending on whether Orbis Chance is running inside the Orbis application. */
const insideOrbis =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as unknown as { api?: { chanceStore?: unknown } }).api?.chanceStore === 'function';

export const insideOrbisApp = insideOrbis;
/** "in this browser" or "in your Orbis profile". */
export const SAVED_WHERE = insideOrbis ? 'in your Orbis profile' : 'in this browser';
export const STORAGE_DESCRIPTION = insideOrbis
  ? 'Your Orbis profile, in its own folder on this computer. Nothing is sent to a server.'
  : 'IndexedDB in this browser, on this computer. Nothing is sent to a server.';
