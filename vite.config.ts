import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import pkg from './package.json' with { type: 'json' }

/** 表示用のビルド情報（バージョン・ビルド日・コミット）。取れないときは空にする */
function buildInfo() {
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? ''
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      sha = ''
    }
  }
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  return { version: pkg.version, date, sha }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages などのサブパスでも動くよう相対パスにする
  base: './',
  define: {
    __APP_BUILD__: JSON.stringify(buildInfo()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        // 姿勢推定の wasm とモデルは大きいので precache せず、使ったときにキャッシュする
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: '筋トレログ',
        short_name: '筋トレログ',
        description: '記録するほど次の目標が正確になる筋トレログ',
        lang: 'ja',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: '#f5f6f8',
        background_color: '#f5f6f8',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
