import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The control panel is a separate app rooted at control/, built into
// dist/control/ — which is exactly what server/index.js serves at "/".
//
// In dev (`npm run dev`) Vite serves the panel on :5173 and proxies API, card
// images and the WebSocket through to the Node server on :3001, so you get HMR
// on the panel while still talking to real state.
export default defineConfig({
  root: 'control',
  plugins: [react()],
  build: {
    outDir: '../dist/control',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api':   'http://localhost:3001',
      '/cards': 'http://localhost:3001',
      '/ws':    { target: 'ws://localhost:3001', ws: true },
    },
  },
})
