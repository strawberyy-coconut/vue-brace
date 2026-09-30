import { compileBrace } from './compile.ts'

/** `<template lang="brace">` — the value `@vitejs/plugin-vue` keys the preprocessor on. */
export const BRACE_LANG = 'brace'

/**
 * The shape `@vue/compiler-sfc` resolves a custom template `lang` to.
 *
 * `vue-loader`/`@vitejs/plugin-vue` reach this through the `preprocessLang` option and
 * the callback **must** be called synchronously — `compiler-sfc`'s `preprocess()` is
 * deliberately synchronous so it can be used from require hooks.
 */
export interface BracePreprocessor {
  render(
    source: string,
    options: unknown,
    cb: (err: Error | null, result?: string) => void,
  ): void
}

export const bracePreprocessor: BracePreprocessor = {
  render(source, _options, cb) {
    try {
      cb(null, compileBrace(source))
    } catch (e) {
      cb(e as Error)
    }
  },
}
