import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'

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
      define: { __GROQ_API_KEYS__: JSON.stringify(list(env.GROQ_API_KEY)), __MISTRAL_API_KEYS__: JSON.stringify(list(env.MISTRAL_API_KEY)) },
      build: {
        rollupOptions: {
          external: ['ssh2', 'node-pty', 'cpu-features', 'basic-ftp']
        }
      }
    },
    preload: {
      build: {
        rollupOptions: {
          // The app's preload, and the bridge a sandboxed Page talks to. (Orbis's browser is Chromium and has no
          // Electron preload scripts of its own; `page` is for the Page frames the app itself hosts.)
          // `player` is the bridge for the hidden window that plays Orbis Music: four messages and nothing else.
          input: { index: resolve('src/preload/index.ts'), page: resolve('src/preload/page.ts'), player: resolve('src/preload/player.ts') }
        }
      }
    },
    renderer: {
      plugins: [react()],
      resolve: { alias: { '@jarvis': resolve('src/renderer/src/features/jarvis') } },
      css: { postcss: { plugins: [tailwindcss({ config: resolve('src/renderer/src/features/jarvis/tailwind.config.cjs') })] } },
      build: {
        rollupOptions: {
          // Two pages: the app itself, and the window nobody sees that holds the one <audio> element Orbis Music
          // plays through. It is a page rather than something generated at runtime so it is built, typed and checked
          // like everything else.
          input: { index: resolve('src/renderer/index.html'), player: resolve('src/renderer/player.html'), files: resolve('src/renderer/files.html') }
        }
      }
    }
  }
})
