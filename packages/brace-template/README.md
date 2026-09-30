# @vue-brace/brace-template

Brace-delimited control flow for Vue SFC templates. See `BRACE-TEMPLATE.md` at the
repository root for the syntax and the design rationale.

## Setup

```ts
// vite.config.ts
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { braceTemplateOptions } from '@vue-brace/brace-template/vite'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [vue({ template: braceTemplateOptions(require) })],
})
```

```ts
// main.ts
import { createApp } from 'vue'
import { installBrace } from '@vue-brace/brace-template'
import App from './App.vue'

const app = createApp(App)
installBrace(app) // required for @try / @catch / @pending
app.mount('#app')
```

The `<template lang>` attribute *is* the registration; nothing else needs to change.

## API

| Export | Entry | Purpose |
| --- | --- | --- |
| `compileBrace(source)` | `.` | brace template → Vue template |
| `compileBraceWithMap(source)` | `.` / `./compile` | the same, plus a generated→source map |
| `createOffsetMapper(source, generated, lines)` | `.` / `./mapper` | maps a generated offset back to a source offset |
| `bracePreprocessor` | `.` / `./preprocessor` | the `{ render }` object `compiler-sfc` resolves |
| `braceTemplateOptions(require?)` | `./vite` | the `template` option for `@vitejs/plugin-vue` |
| `BraceTry` | `.` / `./BraceTry` | runtime boundary component |
| `installBrace(app)` | `.` | registers `BraceTry` globally, as `@try` requires |

`braceTemplateOptions` routes every other language through the supplied `require`, because
`compiler-sfc` stops consulting `@vue/consolidate` once `preprocessCustomRequire` is given —
without that, `lang="pug"` would silently stop working.

Import from `./vite` (rather than the root entry) in build configuration: it only reaches
DOM-free code, so it is safe to type-check under a Node `lib`.

## Notes

- `compileBraceWithMap().lines[i]` describes generated line `i + 1` as
  `{ source, segments }`, where each segment is `{ gen, src, length }`: generated columns
  `gen … gen + length` were copied verbatim from source columns `src … src + length`. A
  generated column covered by no segment is synthesised markup, and resolves by the fallback
  rule described below. `createOffsetMapper` is the exported wrapper, and the Volar plugin
  uses it to map AST locations back.

  A single shift per line is not enough, which is why this is a list of segments: a
  `@for (item of items; index i; key item.id) {` line becomes
  `<template v-for="item in items" :key="item.id">`, and only per-fragment mapping puts
  `items` and `item.id` where their hovers and completions belong.
- The position one column *past* the end of a segment maps to the same place in the source,
  not to the start of the line. Ranges end there, so this is what keeps a hover highlight or
  a diagnostic covering exactly the token the author wrote.
- Synthesised text (`</template>`, `<template v-if="`, the `#catch="[e, retry]"` scaffolding) maps
  to the *end of the nearest copied run*, or to the end of the source line when there is none.
  Not the start of the line: that is where the delimiter sits (`} @pending {`), and Volar
  derives semantic tokens from the compiled template, so tokens with no source counterpart
  used to land on those keywords and repaint them as `property`.
- **When synthesised text contains something Volar highlights, wherever you put it costs
  columns.** Volar maps a generated token by mapping both of its ends through the mapping, so a
  run of N characters anchored at source position *p* paints the N characters that follow *p*.
  `@empty`'s condition used to be such a run — `!<list>.length`, synthesised in full, with two
  identifiers Volar highlights — and no anchor made it harmless: parked at the end of the line,
  the six-character `length` token painted the line *below* it. It is now a prop instead
  (`<BraceEmpty :list="items">`), so the list is the author's own text copied 1:1 and nothing
  synthesised is left to highlight. The general rule: anchor a *delimiter* to real author text
  and keep the rest character-for-character what was written (how `@catch`'s brackets work), or
  move the expression out of the template entirely.
- Errors are thrown as `[@brace] <problem> (template line N)`, relative to the template
  block rather than the SFC. Brace errors reach the reporter verbatim, so this is the only
  accurate position available — see the repository README on `patchErrors`.
