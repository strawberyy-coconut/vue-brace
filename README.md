# vue-brace

Brace-delimited control flow (`@if`, `@for`, `@switch`, `@try`) for Vue SFC templates,
compiled down to ordinary Vue templates.

## Layout

| Path | What it is |
| --- | --- |
| `packages/brace-template` | The compiler, the `compiler-sfc` preprocessor, the `BraceTry` / `BraceEmpty` runtime boundaries and a Vite helper |
| `packages/language-plugin-brace` | Volar / Vue language tools plugin, so `lang="brace"` templates are type-checked |
| `packages/vscode-vue-brace` | VS Code extension providing the `brace` language id and a TextMate grammar |
| `playground` | Vite + Vue app with a `/brace` demo route exercising every construct |
| `BRACE-TEMPLATE.md` | Design doc, syntax reference and implementation status |
| `docs/internals/volar-and-editor-notes.md` | Why the offsets look the way they do — read before touching mapping code |
| `docs/distribution.md`, `docs/releasing.md` | How the packages reach consumers, and how to cut a version |
| `scripts/` | Build, type-check and diagnostic tooling (`brace-synth.ts` maps compiled text back) |

## Commands

Everything runs through Deno; there is no Node in this container.

```sh
deno install            # install workspace dependencies (needed once)
deno task dev           # builds the packages, then starts the playground dev server
deno task test          # builds the plugin, runs all four suites, then the type-level checks
deno task check:types   # tsc over packages/*/type-tests (Vue's SlotsType needs tsc, not deno check)
deno task check:pack    # every exports target exists and none points at TypeScript
deno task build:plugin  # compile the Volar plugin for Node — see “Editor support”
deno task registry      # the repository's own npm registry, on :4873 (see docs/distribution.md)
deno task release       # build, pack and publish both packages — `--local` for that registry
deno task build         # production build of the playground
deno task lint          # oxlint + eslint in playground, oxlint over packages/ and scripts/
deno task type-check    # vue-tsc --build, needs a Node runtime (see “Known issues”)
deno task format        # oxfmt over playground/src only — the packages are hand-formatted
deno task preview       # serve the production build locally
deno task --cwd=packages/vscode-vue-brace scopes  # dump the token scopes a brace file gets
```

## How the pieces fit

```
playground/vite.config.ts
  vue({ template: braceTemplateOptions(require) })
             │
             ▼
  bracePreprocessor.render(source, opts, cb)   ← resolved by compiler-sfc via `lang`
             │
             ▼
  compileBrace(source)  →  <template v-if="…"> / <template v-for="…"> / <BraceTry>
             │
             ▼
  normal Vue compiler  →  render function   (so custom renderers keep working)
```

`compileBrace` is **one output line per input line**. That is load-bearing: when a
preprocessor runs, `compiler-sfc` discards the template AST and merges a line-only source
map, so preserving line count is what keeps positions pointing at the original source.

`@try` needs a runtime component, and a template preprocessor cannot add imports to
`<script setup>`, so `BraceTry` must be registered globally:

```ts
import { installBrace } from '@cockernutx/brace-template'
installBrace(app)
```

## Editor setup

Syntax highlighting and language features need **two** pieces, because they are separate
mechanisms:

| | Provided by | What it does |
| --- | --- | --- |
| Highlighting | `packages/vscode-vue-brace` | registers the `brace` language id and a TextMate grammar |
| Language features | `packages/language-plugin-brace` | completions, hover, navigation and diagnostics inside brace templates |

Volar's own `text.html.vue` grammar — which highlights the file you are actually looking at —
carries hardcoded block rules per template language (`lang="html"`, `lang="pug"`, …) that
delegate the block content to a scope by name. A language Volar does not know has no rule, so
the block falls through to HTML and every brace construct renders as plain text. The
extension injects the missing rule for `brace`, and separately re-injects Vue's directive and
interpolation grammars into the brace scope, since Volar only targets a fixed list of scopes.

Language features also need the plugin **built**, because Volar loads it with `require()` in a
Node process:

```sh
deno task build:plugin          # compiles packages/language-plugin-brace/src to dist/
```

`deno task test` does this first, but editing plugin source and reloading the window without
building leaves the editor running the previous build — or, if it has never been built,
running with no plugin at all. That failure is silent, which is why it is worth knowing:
`packages/language-plugin-brace/README.md` explains the mechanism and the warning that is
the only trace of it.

Beyond that, language features work as soon as the project declares the plugin, which
`playground/tsconfig.app.json` already does:

```jsonc
{ "vueCompilerOptions": { "plugins": ["@cockernutx/language-plugin-brace"] } }
```

The highlighting extension has to be installed into the VS Code server running *inside*
the dev container:

```sh
ln -s /workspaces/vue-brace/packages/vscode-vue-brace \
      /root/.vscode-server/extensions/cockernutx.vscode-vue-brace-0.1.1
```

then **Developer: Reload Window**. See `packages/vscode-vue-brace/README.md` for details and
for how to check it worked.

## Known issues

**The language plugin has to be built for the editor to load it.** Volar resolves a plugin
and calls `require()` on it in both `vue-tsc` and the editor's language server, which are
Node processes. Serving TypeScript source works only under Deno, so an unbuilt plugin is a
`SyntaxError` that Volar swallows: brace templates lose hover, completions and diagnostics,
and — worse — Volar falls back to parsing the raw brace text as a template, reporting errors
on `@if (…)` lines and on markup that is perfectly valid. `deno task build:plugin` (also run
by `deno task test`) fixes it; `packages/language-plugin-brace/README.md` has the details and
the one-line warning to look for in the Vue Language Server output channel.

**`@for` with `index` / `key` and the `@catch` bindings are the two places where the
compiler's output has to line up with the author's text exactly.** Volar reads some positions
out of the AST but *slices* the generated markup with others, so wherever generated text and
the author's text disagree — a `v-for` element shifted by a synthesised wrapper, an expression
rewritten into a different shape — the result is garbage binding names, tokens landing on
unrelated markup, or bindings that hover as nothing at all. Both cases are handled, and the
rules behind them are load-bearing: read `docs/internals/volar-and-editor-notes.md` before
touching offsets in `compile.ts` or `packages/language-plugin-brace`.

Inside `@try` / `@catch` / `@pending`, every binding is `any` if `<BraceTry>` does not
resolve. The component declares itself globally (`GlobalComponents`) and so does
`playground/env.d.ts`; if hover inside those blocks reports `any` for *everything*, that is
what to look at, not the compiler.

**`vue-tsc` does not work under Deno.** Volar registers the `.vue` extension by hooking
`fs.readFileSync`, intercepting the read of `tsc.js` and rewriting its source text. Deno
loads CommonJS natively and never routes module loads through `fs.readFileSync`, so
TypeScript is loaded unpatched: `.vue` files are not in the program, `.vue` imports fail
to resolve, and the failure is *silent* because Volar's internal assertions never run.
`deno task type-check` therefore reports `TS2307: Cannot find module './App.vue'` on a
stock scaffold. Options: install Node in the container and run `vue-tsc` with it, or drop
`vue-tsc` and rely on `deno task test`. The VS Code Volar extension uses a different code
path and is unaffected.

**Lint cannot see brace templates.** `vue-eslint-parser` falls back to parsing the raw
brace text as HTML, so no template node registers a usage: `no-unused-vars` fires for every
binding the template consumes, and `eslint-plugin-vue`'s template rules never fire. Pug has
the same problem. The files that use `lang="brace"` currently opt out via a scoped override
in `playground/eslint.config.ts`; the real fix is a processor that runs `compileBrace`
before parsing (the transform is line-preserving, so rule locations would stay correct).

**Template error line numbers are wrong for any rewriting preprocessor.** `compiler-sfc`'s
`patchErrors` locates the preprocessed source inside the original with `indexOf`, which is
always `-1` here, and then shifts errors by a bogus amount. Source *maps* are unaffected,
and because `compileBrace` records every copied fragment they are column-exact for every
expression, not just the first one on a rewritten line. `compileBrace`'s own errors carry
accurate line numbers, since they are thrown from the preprocessor and reported verbatim.

**Every entry resolves to built JavaScript, so the packages are publishable as they stand.**
`deno task build:plugin` emits two builds: CommonJS in `dist/` — Volar's language server and
`vue-tsc` are Node processes and `require()` the entries the plugin uses — and ESM in `dist/esm/`,
which is what bundlers and Deno import. `exports` never hands a consumer TypeScript, `files` ships
only `dist`, and declarations are emitted so a consumer's `types` condition resolves to real
`.d.ts`. The trade-off is that the workspace consumes those builds too: run
`deno task build:plugin` after editing the compiler, or let `deno task dev` / `deno task test`
do it for you. See `docs/releasing.md`.
