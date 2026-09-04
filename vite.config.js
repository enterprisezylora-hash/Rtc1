import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const API_PROXY_HTTP_TARGET = process.env.VITE_API_PROXY_HTTP_TARGET || 'http://api.internal:8787'
const API_PROXY_WS_TARGET = process.env.VITE_API_PROXY_WS_TARGET || 'ws://api.internal:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_PROXY_HTTP_TARGET,
        changeOrigin: true,
      },
      '/media': {
        target: API_PROXY_HTTP_TARGET,
        changeOrigin: true,
      },
      '/ws': {
        target: API_PROXY_WS_TARGET,
        ws: true,
      },
    },
  },
})
