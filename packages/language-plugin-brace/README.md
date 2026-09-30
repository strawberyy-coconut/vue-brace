# @cockernutx/language-plugin-brace

Volar / Vue language tools plugin for `lang="brace"` templates.

Without it, Volar hands the brace source to the HTML parser: template expressions are never
*checked*, so `@if (…)` / `@for (…)` conditions are seen as plain text and the whole block
produces spurious errors and no hover.

## Build before you use it

```sh
deno task build:plugin     # from the repo root
```

**Volar loads a language plugin by resolving it and calling `require()` on the result**, in
`vue-tsc` and in the editor's language server — both Node processes. Serving
`src/index.ts` works only under Deno, which can `require()` TypeScript directly. In Node it
is a `SyntaxError`; Volar catches it and carries on **without the plugin**, so every brace
template loses hover, completions and diagnostics, and the only trace is a warning in the
Vue Language Server output channel:

```
[Vue] Resolve plugin path failed: @cockernutx/language-plugin-brace SyntaxError: …
```

This is the failure mode this package was written in, and it is worth knowing because it
looks like "the plugin does nothing" rather than "the plugin did not load". `index.cjs`
therefore loads `dist/index.js`, and `deno task test` rebuilds it; a test fails if `dist` is
missing or older than the source it came from.

**How to tell it loaded:** open a brace template and hover a variable in a `@try` block. With
the plugin loaded you get a type; without it, `any` (or nothing) — and Volar will be reporting
errors on lines of brace syntax that are perfectly valid. **Reload the window** after building:
the language server only loads plugins at startup.

## Setup

```jsonc
// tsconfig.app.json
{
  "vueCompilerOptions": {
    "plugins": ["@cockernutx/language-plugin-brace"]
  }
}
```

## How it works

Volar reaches a custom template language through three hooks. The plugin implements all
three:

1. **`getEmbeddedCodes` / `resolveEmbeddedCode`** — publish the raw brace block as an
   embedded document with `lang: 'brace'`. Volar's built-in `vue-sfc-template` plugin only
   does this for `lang === 'html'`, so without these hooks a brace template has no virtual
   file at all: no highlighting and no in-template features.
2. **`compileSFCTemplate`** — compiles the generated template with language-core's
   `compileTemplate` and supplies the AST that template type checking works from.
3. **Offset remapping** — every location in that AST is rewritten back into brace-source
   coordinates.

Step 3 is why `compileBrace` returns a map. Because the transform emits one line per input
line, a generated line belongs to exactly one source line, and within it every copied
fragment is recorded as a `{ gen, src, length }` segment. A generated position inside one of
those segments maps to the exact source character; anything else is synthesised markup
(`<template v-if="…">`) and falls back to the end of the nearest copied run, or to the end of
the source line when it has none.

Per-fragment mapping matters more than it sounds. One `@for` line becomes
`<template v-for="item in items" :key="item.id">`, so `item`, `items` and `item.id` all sit
at different offsets from their generated counterparts; a single shift per line gets only
the first of them right, and the rest — the ones outside an `@if` line, which is most of a
template — point at the wrong token, which is what makes hover and go-to-definition fail.

The embedded content pushed in step 1 is the *raw brace source*, which is the same
coordinate space the remapped AST uses. Keeping those two in step is the whole trick, and
it is why the two hooks cannot be implemented independently.

A malformed block is reported through `onError` rather than thrown, so a bad template
produces a diagnostic instead of a dead language server.

### Why the AST must stay in brace coordinates

Volar does not only read offsets out of this AST — it also slices text:

- `options.template` (the brace source) is sliced using AST offsets, so offsets have to be
  brace coordinates for expressions, props and children to map anywhere sensible.
- `parseVForNode` slices `node.loc.source` — the *generated* text — using offsets relative to
  the node. That is the one place where the two coordinate spaces collide, and it is what used
  to make `@for` with `index` / `key` report two TypeScript syntax errors; the alignment pass
  described under Caveats is what reconciles them. Everything else is consistent because both
  the offsets and the document they describe end up in brace coordinates.

## Highlighting

The `lang: 'brace'` embedded document needs a grammar to be useful, which VS Code can only
get from an extension. `packages/vscode-vue-brace` registers that language id and a TextMate
grammar — install it as described in its README. Without it, brace templates render as
plain text.

## Entry point

Volar resolves plugin names with `require()` and then calls the resolved module *itself* as
the factory (no `.default` unwrapping), so the entry has to be a callable CommonJS module
that **Node** can load. `index.cjs` re-exports the default from `dist/index.js`, which
`deno task build:plugin` produces. Pointing it at `src/index.ts` instead is the trap
described at the top of this file: Deno loads it happily and the editor never does.

## Caveats

- The plugin API version is pinned to `2.2`. language-core's `validVersions` is
  `[2, 2.1, 2.2]`; anything else makes it drop the plugin with only a console warning.
- **`@for` with `index` or `key` needs the element aligned to the author's column.** Volar
  rebuilds the
  `v-for` binding by slicing the generated `<template v-for="(item, i) in …">` text with
  offsets *relative to the element*, so those deltas have to come out as the generated ones.
  `collectVForPatterns` reads the binding names with generated deltas *before* the remap;
  `alignVForPatterns` then anchors the element on the `@for` column the author wrote and
  rebuilds `loc.source` as a padded pattern occupying the author's own columns. Before that,
  the slice produced garbage: the errors above, plus garbage binding names whose semantic
  tokens landed across the template. (An earlier attempt moved the element's start onto the
  generated geometry instead. That repairs the slice and corrupts every other consumer of that
  offset, which reads it as a *source* position — do not reintroduce it.)
- **`vue-tsc` needs a Node runtime.** It cannot run under Deno — Volar registers `.vue`
  support by rewriting `tsc.js` through an `fs.readFileSync` hook that Deno bypasses — so a
  Node binary has to be present to type-check templates. That is how the loader bug above was
  found: `node …/vue-tsc.js --noEmit` reported `Resolve plugin path failed`, and
  `--listFiles` showed no `.vue` files in the program at all.

