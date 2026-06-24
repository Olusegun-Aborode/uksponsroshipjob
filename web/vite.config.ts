import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Builds to web/dist, which Express serves. Dev server proxies /api to the Express backend.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
})
