import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Reads .env, .env.local, .env.[mode] and .env.[mode].local; only GROQ_* keys are loaded.
  const env = loadEnv(mode, process.cwd(), 'GROQ_')
  const keys = (env.GROQ_API_KEY ?? '').split(/[\s,]+/).filter(Boolean)
  return {
    main: {
      define: { __GROQ_API_KEYS__: JSON.stringify(keys) }
    },
    preload: {},
    renderer: {
      plugins: [react()]
    }
  }
})
