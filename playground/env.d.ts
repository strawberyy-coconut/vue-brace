/// <reference types="vite/client" />

/**
 * `compileBrace` emits `<BraceTry>` for `@try` blocks and `<BraceEmpty>` for `@empty` blocks,
 * and nothing in the file imports them — the tags have to resolve globally (see
 * `installBrace`). The components carry their own declarations for this, but repeating them here
 * shows what a project has to do if the automatic one is not picked up, and makes the dependency
 * visible to anyone reading the app. Without a declaration the tag is an unknown component, and
 * `@catch (e, retry)` bindings are typed `any`.
 */
import type { BraceEmpty, BraceTry } from '@cockernutx/brace-template'

declare module 'vue' {
  interface GlobalComponents {
    BraceTry: typeof BraceTry
    BraceEmpty: typeof BraceEmpty
  }
}

