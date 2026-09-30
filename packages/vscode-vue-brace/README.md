# vscode-vue-brace

VS Code extension providing **syntax highlighting** for `lang="brace"` templates in Vue SFCs.
Grammar only — no activation code, no language server, no runtime.

| Highlighted by this extension | Language features come from |
| --- | --- |
| the `brace` block, `{{ … }}`, and Vue's `:prop` / `@click` / `v-` | [`@cockernutx/language-plugin-brace`](../language-plugin-brace) — completions, hover, navigation, diagnostics |

Why highlighting here needs injected grammars rather than just a language registration is
written up in [`docs/internals/volar-and-editor-notes.md`](../../docs/internals/volar-and-editor-notes.md).

## Installing

This extension is sideloaded into the dev container rather than installed from the Marketplace:
the VS Code server runs *inside* the container, so link the package into its extension directory
and reload the window:

```sh
ln -s /workspaces/vue-brace/packages/vscode-vue-brace \
      /root/.vscode-server/extensions/cockernutx.vscode-vue-brace-0.1.1
```

The folder name must be `<publisher>.<name>-<version>` — it has to match this package's
`publisher`, `name` and `version` fields, or VS Code will not load it.

Then run **Developer: Reload Window** from the command palette. To confirm, open a `.vue`
file with `lang="brace"` and use **Developer: Inspect Editor Tokens and Scopes** on an
`@if` line; the scope should read `keyword.control.brace`.

To remove it, delete the symlink and reload.

## What is highlighted

| Construct | Example |
| --- | --- |
| Block openers | `@if (…) {`, `@for (…) {`, `@switch (…) {`, `@try {` |
| Continuations | `} @else if (…) {`, `} @else {`, `} @empty {`, `} @pending {`, `} @catch (…) {` |
| Switch arms | `@case 'loading': {`, `@default: {` |
| Block closers | `}` |
| Line comments | `// a note` (only at a line start, so URLs stay text) |
| Dynamic tags | `<{expr}>`, `<{expr} attr="x" />`, `</{expr}>` |
| Interpolation | `{{ … }}` |

Everything else is delegated to **Vue's own tag rules followed by VS Code's HTML grammar** — the
same order Volar's `html-stuff` uses — so markup inside a brace block highlights like it does in
an ordinary `<template>`, and expressions use `source.ts#expression`. `@for` clauses (`index i`,
`key item.id`) are not valid JavaScript, so they highlight loosely. Vue's rules have to come
first, and no grammar may include `text.html.vue` as a whole; `manifest.spec.ts` asserts the
graph stays acyclic, and the internals note explains both traps.

## Troubleshooting

Grammar contributions are declarative: this extension has no `main`, so it never
"activates" and will not show up as an activated extension. If a brace template has no
brace highlighting:

1. **Reload the window.** Injected grammars are only picked up on reload; editing
   `package.json` afterwards needs another one.
2. Put the cursor on an `@if` line and run **Developer: Inspect Editor Tokens and Scopes**.
   The `language` field will read `vue` (the visible document is the SFC) — what matters is
   the scope list:
   - **`text.html.brace` present and `@if` scoped `keyword.control.brace`** — working.
   - **Only `text.html.derivative` and `text.html.vue`** — the block rule is not being
     applied, so the block is falling through to HTML. Check that
     `syntaxes/brace.vue-block.json` exists and is listed in `contributes.grammars` with
     `injectTo: ["text.html.vue"]`.
3. Confirm the extension is present: `ls ~/.vscode-server/extensions | grep brace`.

The tests in `src/__tests__/grammar.spec.ts` tokenise representative lines with
`vscode-textmate` + `vscode-oniguruma` and assert on the resulting scopes, so the grammar is
verified mechanically rather than by eye. `vue-block.spec.ts` goes further and tokenises a
whole SFC through Vue.volar's real grammar, with the injection applied the way VS Code
applies it; it skips when Vue.volar is not installed.

For anything the tests do not cover, dump the scopes — and the colours — the editor would
apply to a real file:

```sh
cd packages/vscode-vue-brace
deno task scopes                        # flags lines that escape the brace grammar
deno task scopes path/to/File.vue --all # every token and its full scope chain
deno task scopes --theme theme.json     # resolve each scope through a theme, and print colours
```

This reproduces the real pipeline — block injection, directive injection and Vue.volar's own
grammar. **Scopes alone are not highlighting:** a scope nothing matches renders as plain text,
so pass `--theme` with a theme JSON file to see the colour each token actually gets.

VS Code's built-in grammars (`html`, `typescript`, `css`) ship inside the editor, so they are not
on disk in a dev container. The script looks for fetched copies in `$BRACE_GRAMMARS` (default
`/tmp/vscode-grammars`) and prints which grammars it stubbed, so the report says how much of
itself to trust.
