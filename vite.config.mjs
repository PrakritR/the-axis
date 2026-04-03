import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['leaflet', 'react-leaflet'],
  },
  server: {
    port: 5173
  }
})
