# vscode-vue-brace

VS Code extension providing **syntax highlighting** for `lang="brace"` templates in Vue
SFCs. Grammar only — there is no activation code, no language server and no runtime.

## Why these pieces exist

| | Provided by | Does |
| --- | --- | --- |
| Block highlighting | this extension | hands `<template lang="brace">` content to the brace grammar |
| `{{ … }}` | this extension | scopes interpolations itself; Volar's interpolation grammar never reaches a custom scope |
| `:prop`, `@click`, `v-` | this extension | re-injects Volar's directive grammar into the brace scope |
| Language features | `@vue-brace/language-plugin-brace` | completions, hover, navigation, diagnostics inside brace templates |

### Highlighting is a grammar-injection problem

It is tempting to assume that registering a language id and a grammar is enough, because
Volar's `resolveCommonLanguageId` passes an unknown template `lang` through unchanged. It is
not, and the failure is silent — so it is worth spelling out.

The file you are looking at is highlighted by Volar's own `text.html.vue` grammar (the `.vue`
file's language is `vue`). Embedded documents — the ones `getEmbeddedCodes` produces — drive
*language features* and semantic tokens, not the base highlighting of the visible file.

Volar's `text.html.vue` carries **hardcoded block rules per template language**, each
delegating the block's content to a scope by name. The `pug` one, for example, matches a tag
whose attributes contain `lang="pug"`, and then scopes everything between `>` and `</` as
`text.pug` with `include: text.pug`. `html`, `pug`, `stylus` and others all have such a rule.

A language Volar does not know — `brace` — has no rule, so the block falls through to
`text.html.derivative` and every brace construct renders as plain HTML text.

Two injections fix that, both contributed by this extension:

- **`syntaxes/brace.vue-block.json`** injects the missing block rule into `text.html.vue`,
  delegating the content to `text.html.brace`.
- **`syntaxes/brace.vue-support.json`** re-injects `vue.directives` into `text.html.brace`,
  because Volar only lists `text.html.vue`, `text.html.markdown`, `text.html.derivative` and
  `text.html.pug` as injection targets. Without it, `:prop`, `@click` and `v-` inside a brace
  template would fall back to plain HTML attributes.

The block also declares `unbalancedBracketScopes` for its delimiters. A brace delimiter is
unbalanced by design — `@if (x) {` opens a brace that closes several lines later — and
without the exemption VS Code colours every one of them as an unmatched bracket, which is
what the `.vue` language's own grammar does for `meta.brace.angle` and friends.

## Installing

This is a **development-time extension for this workspace**, not a published one. The VS
Code server runs inside the dev container, so install it there by linking it into the
extension directory and reloading the window:

```sh
ln -s /workspaces/vue-brace/packages/vscode-vue-brace \
      /root/.vscode-server/extensions/vue-brace.vscode-vue-brace-0.1.0
```

The folder name must be `<publisher>.<name>-<version>` — it has to match this package's
`publisher`, `name` and `version` fields, or VS Code will not load it.

Then run **Developer: Reload Window** from the command palette. To confirm, open a `.vue`
file with `lang="brace"` and use **Developer: Inspect Editor Tokens and Scopes** on an
`@if` line; the scope should read `keyword.control.brace`.

To remove it, delete the symlink and reload.

Publishing it for real would need `vsce package`, which needs Node — not available in this
container.

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

Everything else is delegated to **Vue's own tag rules followed by VS Code's HTML grammar** —
the same order Volar's `html-stuff` uses — so markup inside a brace block highlights as it does
in an ordinary `<template>`. Expressions delegate to `source.ts#expression`, the same grammar
Vue's directive and interpolation rules use. `@for` clauses (`index i`, `key item.id`) are not
valid JavaScript, so they only highlight loosely. Dynamic tags (`<{expr} attr="x">`) hand
their attributes to the rules Vue's own tag rule uses (`text.html.vue#vue-directives` and
`text.html.basic#attribute`).

Why the order matters, and why the whole grammar must not be included:

- `text.html.basic` alone scopes any tag whose name has no hyphen — every component — as
  `invalid.illegal.unrecognized-tag.html`, so `<FragileChild>` came out painted with the
  theme's error colour. Vue's `#capitalized-tag` and `#self-closing-tag` know unrecognized
  tags are components, which is why they are included first.
- Including **`text.html.vue` as a whole** is a reference cycle: this extension injects the
  block rule *into* `text.html.vue`, so that grammar reaches `text.html.brace` and back. VS
  Code then loses the markup scoping entirely and the block renders as plain text. Only
  repository includes (`text.html.vue#capitalized-tag`) are safe — they pull in one rule.
  `manifest.spec.ts` asserts the graph stays acyclic and names the cycle if it does not.

### Vue syntax in a brace template

Volar injects `vue.directives` and `vue.interpolations` into exactly four scopes —
`text.html.vue`, `text.html.markdown`, `text.html.derivative` and `text.pug` (see
`contributes.grammars` in `Vue.volar`'s `package.json`). A brace template has its own scope,
so Vue's `:prop`, `@click` and `v-` highlighting would be missing and those attributes would
look like plain HTML.

`syntaxes/brace.vue-support.json` therefore re-injects `vue.directives` into
`text.html.brace`. This is the same mechanism Volar uses for Pug, just declared from our
side.

Interpolation is the exception, and it is worth being precise because the obvious reading is
wrong: including Volar's `vue.interpolations` grammar has no effect, because that grammar's
rules live in `text.html.vue` and its own selectors are scoped to `text.html.derivative` and
friends. Tokenising a brace template confirms it — `{{` comes back as
`punctuation.definition.interpolation.begin.brace`, i.e. our rule, not Volar's. The
`brace-interpolation` rule in `syntaxes/brace.tmLanguage.json` is what highlights `{{ … }}`,
and it also has to be, since we cannot add `text.html.brace` to Volar's injection list.

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
so pass `--theme` with the theme you are looking at (VS Code theme files are JSON; a
client-side theme extension keeps its copy on your machine, not in this container) and the
report shows the colour each token actually gets.

VS Code's built-in grammars (`html`, `typescript`, `css`) ship inside the editor, so they are
not on disk in a dev container and markup or expressions show no scope until you fetch them.
The script looks in `$BRACE_GRAMMARS` (default `/tmp/vscode-grammars`) and prints which
grammars it stubbed, so the report always says how much of itself to trust:

```sh
mkdir -p /tmp/vscode-grammars && cd /tmp/vscode-grammars
for f in \
  extensions/html/syntaxes/html.tmLanguage.json \
  extensions/html/syntaxes/html-derivative.tmLanguage.json \
  extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json \
  extensions/javascript/syntaxes/JavaScript.tmLanguage.json \
  extensions/css/syntaxes/css.tmLanguage.json
do
  deno eval "await Deno.writeTextFile('$(basename $f)', await (await fetch('https://raw.githubusercontent.com/microsoft/vscode/main/$f')).text())"
done
```

One blind spot worth knowing before you "fix" something: the script loads `text.html.vue` as
the document grammar and reaches `text.html.brace` through the block injection, which makes
`text.html.vue` include *itself*. `vscode-textmate` drops that include, so markup inside the
block comes back unscoped and the script cannot tell you whether the include works. VS Code
compiles each grammar's rules once, so the include resolves there. To test the include, load
`text.html.brace` as the document grammar with `createRegistry(false)` — that is what the
component-tag test in `vue-block.spec.ts` does.
