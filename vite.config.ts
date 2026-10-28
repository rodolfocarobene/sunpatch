import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Two pages: the landing page at / and the app at /app/ (dev/ pages are not built).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
})
