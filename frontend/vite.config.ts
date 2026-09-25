/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'

// Vite config for the PWA build target. The extension build lives in
// vite.extension.config.ts and reuses src/core directly.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
          dest: 'tesseract',
        },
        {
          src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
          dest: 'tesseract',
        },
        {
          src: 'node_modules/tesseract.js/dist/worker.min.js',
          dest: 'tesseract',
        },
        {
          src: 'vendor/tesseract-lang/spa.traineddata.gz',
          dest: 'tesseract',
        },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/shield.svg'],
      manifest: {
        name: 'Protegete',
        short_name: 'Protegete',
        description:
          'Detectá la estafa y aprendé a cuidarte',
        lang: 'es-AR',
        theme_color: '#2d6a4f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Only cache the app shell; never cache API calls (no persistence of
        // analyzed content, and answers must stay live). The tesseract/*
        // OCR assets are large and lazy-loaded on demand, so they are
        // excluded from the precache manifest entirely.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['**/tesseract/**'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  server: {
    // Bind on all interfaces so the dev server is reachable from a phone on
    // the same LAN or through a cloudflared tunnel, not just localhost.
    host: true,
    proxy: {
      // Forward relative /api/... calls (see src/core/api.ts) to the FastAPI
      // backend, so the PWA and backend appear same-origin to the browser.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
    // Vite rejects unknown Host headers by default; a cloudflared quick
    // tunnel serves the app under a random *.trycloudflare.com hostname, so
    // allow that subdomain explicitly.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
    allowedHosts: ['.trycloudflare.com'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
