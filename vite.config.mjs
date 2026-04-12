import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const localApiPort = process.env.LOCAL_API_PORT || '3001'

/** @param {string} v */
function envPoll(v) {
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  return null
}
const pollFlag = envPoll(process.env.VITE_USE_POLLING ?? '')
// Default on: polling catches every save even with iCloud, Docker, or flaky native watchers.
// Set VITE_USE_POLLING=0 if your machine has reliable native events and you want less CPU use.
const useWatchPolling = pollFlag ?? true

export default defineConfig({
  root: './frontend',
  base: '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['leaflet', 'react-leaflet'],
  },
  build: {
    outDir: '../dist',
  },
  server: {
    port: 5174,
    strictPort: true,
    open: '/',
    headers: {
      'Cache-Control': 'no-store',
    },
    watch: useWatchPolling
      ? { usePolling: true, interval: 200 }
      : undefined,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${localApiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
})
