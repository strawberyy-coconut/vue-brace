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

```sh
npm install @cockernutx/brace-template
```

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
Neither one is built on your machine: the published packages ship compiled JavaScript, so this is
install-and-reload.

1. Install the [`vscode-vue-brace`](packages/vscode-vue-brace) extension for highlighting — its
   README has the download/sideload paths and the check that it loaded.
2. Install the Volar plugin and declare it in the project's tsconfig:

```sh
npm install -D @cockernutx/language-plugin-brace
```

```jsonc
{ "vueCompilerOptions": { "plugins": ["@cockernutx/language-plugin-brace"] } }
```

Then run **Developer: Reload Window**.

### Inside this repository

This workspace resolves the packages' `src/`, and Volar loads a language plugin by calling
`require()` on it in a Node process — where TypeScript source is not enough. An unbuilt plugin is a
swallowed `SyntaxError`, and the editor silently runs without language features, so build it once
(and after every plugin change) and reload:

```sh
deno task build
```

`deno task dev` and `deno task test` run that for you.

## Commands

| Command | What it does |
| --- | --- |
| `deno task dev` | builds the packages, then starts the playground dev server |
| `deno task test` | builds the packages, then runs all four suites |
| `deno task build` | builds both packages, then the playground (production) |
| `deno task lint` | oxlint over `packages/` and `containers/`, eslint + oxlint in the playground |
| `deno task check:types` | `tsc` over `packages/brace-template/type-tests` (Vue's `SlotsType` needs tsc, not `deno check`) |
| `deno task type-check` | `vue-tsc --build` (run through `npx`, for a Node runtime) — needs Node, so it runs in the CI container |

Everything else this repository needs is not a task. It lives in [`containers/`](containers) as
shell scripts — there is no CI YAML to read, so these are the deployment:

```sh
docker build -f containers/ci/Containerfile .        # the checks
docker build -f containers/release/Containerfile .   # publish (NPM_REGISTRY, NPM_TOKEN secret)
docker build -f containers/extension/Containerfile --target artifact -o type=local,dest=out .
```

`containers/*/run.sh` is the actual work, so it can be read (and, where the tools exist, run)
directly. A package never reaches up to the root for a task — the root only calls down, and each
package owns its own `build` and `test`.

## Notes

- **Template error line numbers are wrong for any rewriting preprocessor** — `compiler-sfc`'s
  `patchErrors` mislocates the source. Source *maps* are unaffected, and `compileBrace`'s own
  errors carry accurate line numbers.
- **Lint cannot see brace templates.** `vue-eslint-parser` parses the raw brace text as HTML, so
  `no-unused-vars` fires for every binding the template consumes. The affected files opt out with a
  scoped override in `playground/eslint.config.ts`.
- **`vue-tsc` does not work under Deno** — it registers `.vue` support by hooking
  `fs.readFileSync`, which Deno bypasses, and the failure is silent. `deno task check:types` is the
  type check that works here; `deno task type-check` needs Node, so it runs in the CI container.
  The playground's `type-check` therefore goes through `npx`: `deno task` runs a bare
  `node_modules/.bin` command with the Deno runtime, so `vue-tsc` has to be started by something
  that spawns Node.
- **Inside `@try` / `@catch` / `@pending`, bindings hover as `any` if `<BraceTry>` does not
  resolve.** It registers itself globally (`GlobalComponents`, and `playground/env.d.ts` does too).
- **`@for` with `index` / `key`, and the `@catch` bindings, are where generated text has to line up
  with the author's exactly.** Read `packages/brace-template/src/mapper.ts` and the arithmetic the
  plugin's tests replicate in
  `packages/language-plugin-brace/src/__tests__/plugin.spec.ts` before changing offsets.
- Distribution and releases: `containers/release/` — `run.sh` publishes with `npm publish`, and
  `pack.ts` checks the tarballs first for the failures npm does not catch (a missing `exports`
  target, a `src/` file that leaked into `files`).
