import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const localApiPort = process.env.LOCAL_API_PORT || '3001'

export default defineConfig({
  base: '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['leaflet', 'react-leaflet'],
  },
  server: {
    port: 5174,
    strictPort: true,
    open: '/',
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
