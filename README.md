# vue-brace

Brace-delimited control flow (`@if`, `@for`, `@switch`, `@try`) for Vue SFC templates,
compiled down to ordinary Vue templates.

```vue
<template lang="brace">
@if (status === 'loading') {
  <p>Loading…</p>
} @else if (status === 'error') {
  <p>{{ error.message }}</p>
} @else {
  <ul>
    @for (item of items; index i; key item.id) {
      <li>{{ i + 1 }} · {{ item.title }}</li>
    } @empty {
      <li>Sold out</li>
    }
  </ul>
}
</template>
```

Also `@switch (value) { @case 'x': { … } @default: { … } }`, `@try { … } @catch (e, retry) { … }`
with a `@pending` arm, dynamic tags (`<{tag}>`) and `// line comments`.

## Packages

| Package | What it is |
| --- | --- |
| [`@cockernutx/brace-template`](packages/brace-template) | Compiler, `compiler-sfc` preprocessor, `BraceTry` / `BraceEmpty` runtime components and a Vite helper |
| [`@cockernutx/language-plugin-brace`](packages/language-plugin-brace) | Volar / Vue language tools plugin, so `lang="brace"` templates are type-checked |
| [`vscode-vue-brace`](packages/vscode-vue-brace) | VS Code extension providing the `brace` language id and a TextMate grammar |
| [`playground`](playground) | Vite + Vue demo app with a `/brace` route exercising every construct |

## Getting started

Deno is the only toolchain in this container — there is no Node on `PATH`.

```sh
deno install     # install workspace dependencies (needed once)
deno task dev    # builds the packages, then starts the playground dev server
```

In an app:

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

## Editor setup

Highlighting and language features are two separate pieces, and brace templates need both.

1. Install the [`vscode-vue-brace`](packages/vscode-vue-brace) extension — its README has the
   dev-container symlink and the check that it loaded.
2. Declare the plugin in the project's tsconfig:

```jsonc
{ "vueCompilerOptions": { "plugins": ["@cockernutx/language-plugin-brace"] } }
```

3. Build the plugin. Volar loads it with `require()` in a Node process, so TypeScript source is not
   enough: an unbuilt plugin is a swallowed `SyntaxError` and the editor silently runs without
   language features.

```sh
deno task build:plugin
```

Then run **Developer: Reload Window**.

## Commands

| Command | What it does |
| --- | --- |
| `deno task dev` | builds the packages, then starts the playground dev server |
| `deno task test` | builds the plugin, runs all four suites, then the type-level checks |
| `deno task build` | production build of the playground |
| `deno task lint` | oxlint + eslint in the playground, oxlint over `packages/` and `scripts/` |
| `deno task check:types` | `tsc` over `packages/*/type-tests` (Vue's `SlotsType` needs tsc, not `deno check`) |
| `deno task check:pack` | every `exports` target exists and none points at TypeScript |
| `deno task build:plugin` | compiles the compiler and the Volar plugin for Node |
| `deno task registry` | the repository's own npm registry, on `:4873` |
| `deno task release` | build, pack and publish both packages (`--local` for that registry) |
| `deno task type-check` | `vue-tsc --build` — needs a Node runtime, see the notes below |
| `deno task format` | `oxfmt` over `playground/src` only — the packages are hand-formatted |
| `deno task preview` | serve the production build locally |
| `deno task --cwd=packages/vscode-vue-brace scopes` | dump the token scopes a brace file gets |

## Notes

- **Template error line numbers are wrong for any rewriting preprocessor** — `compiler-sfc`'s
  `patchErrors` mislocates the source. Source *maps* are unaffected, and `compileBrace`'s own
  errors carry accurate line numbers.
- **Lint cannot see brace templates.** `vue-eslint-parser` parses the raw brace text as HTML, so
  `no-unused-vars` fires for every binding the template consumes. The affected files opt out with a
  scoped override in `playground/eslint.config.ts`.
- **`vue-tsc` does not work under Deno** — it registers `.vue` support by hooking
  `fs.readFileSync`, which Deno bypasses, and the failure is silent. Use `deno task check:types` and
  the test suites instead.
- **Inside `@try` / `@catch` / `@pending`, bindings hover as `any` if `<BraceTry>` does not
  resolve.** It registers itself globally (`GlobalComponents`, and `playground/env.d.ts` does too).
- **`@for` with `index` / `key`, and the `@catch` bindings, are where generated text has to line up
  with the author's exactly.** Read [`docs/internals/volar-and-editor-notes.md`](docs/internals/volar-and-editor-notes.md)
  before changing offsets.
- Distribution and releases: [`docs/distribution.md`](docs/distribution.md),
  [`docs/releasing.md`](docs/releasing.md).
