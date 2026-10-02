import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  /*
   * Reads .env, .env.local, .env.[mode] and .env.[mode].local.
   *
   * The prefix list is a filter, not a formality: anything outside it is not loaded at all. A MISTRAL_API_KEY line
   * added to .env.local without naming the prefix here is read by nothing and reports no error, so the key looks
   * present and is absent -- which is the kind of thing somebody debugs for an hour.
   */
  const env = loadEnv(mode, process.cwd(), ['GROQ_', 'MISTRAL_'])
  /** Several keys, comma- or space-separated, because Orbis rotates through them when one is busy. */
  const list = (value: string | undefined): string[] => (value ?? '').split(/[\s,]+/).filter(Boolean)
  return {
    main: {
      define: { __GROQ_API_KEYS__: JSON.stringify(list(env.GROQ_API_KEY)), __MISTRAL_API_KEYS__: JSON.stringify(list(env.MISTRAL_API_KEY)) }
    },
    preload: {
      build: {
        rollupOptions: {
          // The app's preload, and the bridge a sandboxed Page talks to. (Orbis's browser is Chromium and has no
          // Electron preload scripts of its own; `page` is for the Page frames the app itself hosts.)
          input: { index: resolve('src/preload/index.ts'), page: resolve('src/preload/page.ts') }
        }
      }
    },
    renderer: {
      plugins: [react()]
    }
  }
})
