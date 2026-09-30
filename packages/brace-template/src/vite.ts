import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BRACE_LANG, bracePreprocessor } from './preprocessor.ts'

export interface BraceTemplateOptions {
  preprocessCustomRequire: (lang: string) => unknown
}

/**
 * The `template` option to hand `@vitejs/plugin-vue`:
 *
 * ```ts
 * import { createRequire } from 'node:module'
 * import { braceTemplateOptions } from '@cockernutx/brace-template/vite'
 *
 * const require = createRequire(import.meta.url)
 *
 * export default defineConfig({
 *   plugins: [vue({ template: braceTemplateOptions(require) })],
 * })
 * ```
 *
 * `compiler-sfc` only consults `preprocessCustomRequire` — there is no fallback to
 * `@vue/consolidate` once it is supplied — so every other lang has to be routed to the
 * caller's `require`, otherwise `lang="pug"` and friends would silently stop working.
 *
 * When no `require` is passed, one is built from the current working directory, which
 * is the project root for a Vite config.
 */
export function braceTemplateOptions(
  require: (id: string) => unknown = createRequire(
    pathToFileURL(resolve(process.cwd(), 'index.js')).href,
  ),
): BraceTemplateOptions {
  return {
    preprocessCustomRequire: (lang: string) =>
      lang === BRACE_LANG ? bracePreprocessor : require(lang),
  }
}
