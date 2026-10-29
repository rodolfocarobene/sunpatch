import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

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
  // Agent worktrees live under .claude/; their copies of the tests must not run here.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
