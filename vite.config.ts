import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// The landing page at /, its Italian twin at /it/, the app at /app/ and the guide pages in guide/ and it/guide/ (dev/ pages are not built).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        it: resolve(import.meta.dirname, 'it/index.html'),
        guides: resolve(import.meta.dirname, 'guide/index.html'),
        guidesIt: resolve(import.meta.dirname, 'it/guide/index.html'),
        guide1: resolve(import.meta.dirname, 'guide/winter-sun-hours-apartment/index.html'),
        guide1It: resolve(import.meta.dirname, 'it/guide/ore-di-sole-appartamento-inverno/index.html'),
        guide2: resolve(import.meta.dirname, 'guide/south-east-west-north-facing-flat/index.html'),
        guide2It: resolve(import.meta.dirname, 'it/guide/esposizione-sud-est-ovest-nord/index.html'),
        guide3: resolve(import.meta.dirname, 'guide/will-neighbouring-building-block-my-sun/index.html'),
        guide3It: resolve(import.meta.dirname, 'it/guide/palazzo-di-fronte-toglie-il-sole/index.html'),
      },
    },
  },
  // Agent worktrees live under .claude/; their copies of the tests must not run here.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
