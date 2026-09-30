# @cockernutx/language-plugin-brace

Volar / Vue language tools plugin for `lang="brace"` templates.

Without it, Volar hands the brace source to the HTML parser: template expressions are never
*checked*, so `@if (…)` / `@for (…)` conditions are seen as plain text and the whole block
produces spurious errors and no hover.

## Setup

```sh
npm install -D @cockernutx/language-plugin-brace
```

```jsonc
// tsconfig.app.json
{
  "vueCompilerOptions": {
    "plugins": ["@cockernutx/language-plugin-brace"]
  }
}
```

That is the whole setup: the package ships built JavaScript, so there is nothing to compile, and
**Developer: Reload Window** is the only other step (the language server loads plugins at startup).

## If the plugin does not load

Volar loads the plugin by calling `require()` on it in a Node process (`vue-tsc` and the editor's
language server). When that fails Volar swallows the `SyntaxError` and runs **without the plugin**:
brace templates lose hover, completions and diagnostics, and the only trace is this line in the Vue
Language Server output channel:

```
[Vue] Resolve plugin path failed: @cockernutx/language-plugin-brace SyntaxError: …
```

**Check it loaded:** hover a variable inside `@try` — a type means loaded, `any` (or nothing)
means not. In that case Volar also reports errors on valid brace syntax.

### Working on the plugin itself

The plugin is TypeScript, and only this repository's Deno toolchain can load that directly; a Node
process needs the build. So from a checkout, compile before the editor will see your changes:

```sh
deno task build:plugin     # from the repo root
```

`index.cjs` loads `dist/index.js`, `deno task test` rebuilds it, and a test fails if `dist` is
missing or older than the source it came from.

## Notes

- Highlighting is separate: install [`vscode-vue-brace`](../vscode-vue-brace) for the `brace`
  language id and the grammar. The plugin only supplies language features.
- The plugin API version is pinned to `2.2`, one of language-core's `validVersions`
  (`[2, 2.1, 2.2]`); anything else drops the plugin with a console warning only.
- **`@for` with `index` / `key`, and the `@catch` bindings, depend on offset alignment that is
  load-bearing.** Read [`docs/internals/volar-and-editor-notes.md`](../../docs/internals/volar-and-editor-notes.md)
  before changing it.
- **`vue-tsc` needs a Node runtime** and cannot run under Deno: Volar registers `.vue` support
  through an `fs.readFileSync` hook that Deno bypasses.