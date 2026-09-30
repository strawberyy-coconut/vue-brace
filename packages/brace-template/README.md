# @cockernutx/brace-template

Brace-delimited control flow (`@if`, `@for`, `@switch`, `@try`) for Vue SFC templates.

```vue
<script setup lang="ts">
const items = ref([{ id: 1, title: 'Ginsu' }])
</script>

<template lang="brace">
@if (items.length) {
  <ul>
    @for (item of items; index i; key item.id) {
      <li>{{ i + 1 }} · {{ item.title }}</li>
    }
  </ul>
} @else {
  <p>Nothing here</p>
}
</template>
```

## Setup

```ts
// vite.config.ts
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { braceTemplateOptions } from '@cockernutx/brace-template/vite'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [vue({ template: braceTemplateOptions(require) })],
})
```

```ts
// main.ts
import { createApp } from 'vue'
import { installBrace } from '@cockernutx/brace-template'
import App from './App.vue'

const app = createApp(App)
installBrace(app) // required for @try / @catch / @pending
app.mount('#app')
```

The `<template lang="brace">` attribute *is* the registration; nothing else needs to change.

## API

| Export | Entry | Purpose |
| --- | --- | --- |
| `compileBrace(source)` | `.` / `./compile` | brace template → Vue template |
| `compileBraceWithMap(source)` | `.` / `./compile` | the same, plus a generated→source map |
| `createOffsetMapper(source, generated, lines)` | `.` / `./mapper` | maps a generated offset back to a source offset |
| `bracePreprocessor` | `.` / `./preprocessor` | the `{ render }` object `compiler-sfc` resolves |
| `braceTemplateOptions(require?)` | `./vite` | the `template` option for `@vitejs/plugin-vue` |
| `BraceTry` | `.` | runtime boundary component for `@try` / `@catch` / `@pending` |
| `BraceEmpty` | `.` | runtime component for `@empty` |
| `installBrace(app)` | `.` | registers both globally, as `@try` / `@empty` require |

## Notes

- Errors are thrown as `[@brace] <problem> (template line N)`, relative to the template block
  rather than the SFC. Template *error* line numbers from `compiler-sfc` are wrong for any
  rewriting preprocessor; source maps are unaffected.
- `braceTemplateOptions` routes every other language through the supplied `require`, because
  `compiler-sfc` stops consulting `@vue/consolidate` once `preprocessCustomRequire` is given —
  without it, `lang="pug"` would silently stop working.
- Import from `./vite` (rather than the root entry) in build configuration: it only reaches
  DOM-free code, so it is safe to type-check under a Node `lib`.
- `compileBraceWithMap()` and `createOffsetMapper()` record, per generated line, the segments
  (`{ gen, src, length }`) copied verbatim from the source; anything else is synthesised markup.
  The mapping rules and the traps behind them are in the comments in `src/mapper.ts` and the
  offsets pinned in
  [`../language-plugin-brace/src/__tests__/plugin.spec.ts`](../language-plugin-brace/src/__tests__/plugin.spec.ts).
