/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Only the shared foundations are forced into a chunk. Everything
        // else — the 29 subject-specific engine modules and the 25 tool
        // screens — is left to Rollup, which splits it along the dynamic
        // imports in `src/app/tools/lazy.ts` so a tool's mathematics arrives
        // with the tool.
        //
        // Routing all of `src/engine/` into one chunk was right when the
        // engine was small and every tool used most of it. At 29 modules that
        // chunk reached 836 kB and was loaded in full the moment any single
        // tool opened, which is the opposite of what splitting the screens
        // was for. The foundations below genuinely are shared by nearly every
        // module, so keeping them together avoids duplicating them into every
        // tool chunk and keeps them cached across interface changes.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          if (/\/src\/engine\/(core|special|random|distributions|stats)\//.test(id)) return 'engine-core';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20000,
  },
});
