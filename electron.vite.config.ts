import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Reads .env, .env.local, .env.[mode] and .env.[mode].local; only GROQ_* and ORBIS_GOOGLE_* keys are loaded.
  // Development builds read .env.development.local and packaged builds .env.production.local, so each can use its own client.
  const env = loadEnv(mode, process.cwd(), ['GROQ_', 'ORBIS_GOOGLE_'])
  const keys = (env.GROQ_API_KEY ?? '').split(/[\s,]+/).filter(Boolean)
  const google = { clientId: (env.ORBIS_GOOGLE_CLIENT_ID ?? '').trim(), clientSecret: (env.ORBIS_GOOGLE_CLIENT_SECRET ?? '').trim() }
  return {
    main: {
      define: { __GROQ_API_KEYS__: JSON.stringify(keys), __ORBIS_GOOGLE__: JSON.stringify(google) }
    },
    preload: {
      build: {
        rollupOptions: {
          // The app's preload, and a small frame script for the in-app browser session (used by ad blocking).
          input: { index: resolve('src/preload/index.ts'), adblockFrame: resolve('src/preload/adblockFrame.ts') }
        }
      }
    },
    renderer: {
      plugins: [react()]
    }
  }
})
