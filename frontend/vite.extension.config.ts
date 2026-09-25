/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'

function abs(relative: string): string {
  // fast-glob (used by vite-plugin-static-copy) requires forward slashes,
  // even on Windows, or `src` globs silently match nothing.
  return fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/')
}

// Vite config for the Chromium MV3 extension build target. Reuses src/core
// directly (shared chat engine, API client, UI, theme) — see
// vite.config.ts for the PWA build. `root` is set to src/extension so
// sidepanel.html and background.js land at the top of dist-extension/,
// matching manifest.json's `side_panel.default_path` / `background.service_worker`.
// No vite-plugin-pwa here: an extension has its own manifest/service-worker
// model and must ship every asset locally (MV3 forbids remote code).
export default defineConfig({
  root: abs('./src/extension'),
  publicDir: false,
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: abs('./src/extension/manifest.json'), dest: '.' },
        { src: abs('./public/icons/icon-192.png'), dest: 'icons' },
        { src: abs('./public/icons/icon-512.png'), dest: 'icons' },
        {
          src: abs('./node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),
          dest: 'tesseract',
        },
        {
          src: abs('./node_modules/tesseract.js-core/tesseract-core-lstm.wasm'),
          dest: 'tesseract',
        },
        {
          src: abs('./node_modules/tesseract.js/dist/worker.min.js'),
          dest: 'tesseract',
        },
        {
          src: abs('./vendor/tesseract-lang/spa.traineddata.gz'),
          dest: 'tesseract',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@core': abs('./src/core'),
    },
  },
  build: {
    outDir: abs('./dist-extension'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        background: abs('./src/extension/background.ts'),
        sidepanel: abs('./src/extension/sidepanel.html'),
      },
      output: {
        // Fixed, extension-relative file names — manifest.json and
        // sidepanel.html reference these paths directly, so no content
        // hashing and no nested directories.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
