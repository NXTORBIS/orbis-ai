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
          // The app's preload, a small frame script for the in-app browser session (used by ad blocking), and the
          // Chrome extension APIs Orbis provides to extension service workers and pages.
          input: { index: resolve('src/preload/index.ts'), adblockFrame: resolve('src/preload/adblockFrame.ts'), extensionApis: resolve('src/preload/extensionApis.ts') }
        }
      }
    },
    renderer: {
      plugins: [react()]
    }
  }
})
