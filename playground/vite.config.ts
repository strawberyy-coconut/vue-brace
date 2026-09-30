import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { braceTemplateOptions } from '@cockernutx/brace-template/vite'

const require = createRequire(import.meta.url)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({ template: braceTemplateOptions(require) }),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
