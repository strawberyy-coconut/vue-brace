import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

import { braceTemplateOptions } from '@vue-brace/brace-template/vite'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [vue({ template: braceTemplateOptions(require) })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.spec.ts'],
  },
})
