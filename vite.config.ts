import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/autobuy': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/autobuy/, '')
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
