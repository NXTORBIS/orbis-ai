import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Reads .env, .env.local, .env.[mode] and .env.[mode].local; only GROQ_* keys are loaded.
  const env = loadEnv(mode, process.cwd(), ['GROQ_'])
  const keys = (env.GROQ_API_KEY ?? '').split(/[\s,]+/).filter(Boolean)
  return {
    main: {
      define: { __GROQ_API_KEYS__: JSON.stringify(keys) }
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
