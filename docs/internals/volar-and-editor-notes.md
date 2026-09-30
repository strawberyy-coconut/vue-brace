# Volar and editor notes

Why the compiler's output and the plugin's offsets look the way they do. Everything here was
measured against the shipped Volar (`@vue/language-core` 3.3.11 and the Vue.volar extension of
the same version); none of it is inferred. If you are about to change offsets in
`packages/brace-template/src/compile.ts`, `src/mapper.ts` or
`packages/language-plugin-brace/src/index.ts`, read this first — the invariants are cheap to
break and the breakage is usually silent.

## The coordinate-space contract

A brace template exists in two coordinate spaces: the author's (the raw brace source) and the
generated one (ordinary Vue markup). `compileBraceWithMap` emits one generated line per input
line, and `createOffsetMapper` maps a generated offset back to a source offset using the
`{ gen, src, length }` segments recorded per line. The plugin then remaps every `offset` in
the AST that `language-core`'s `compileTemplate` returns, and publishes the raw brace source
as the template's embedded document — so both the AST's offsets and the document it describes
are in brace coordinates.

Volar does not only read offsets, it also **slices text with them**, and that is where the two
spaces collide:

| Volar code | What it slices | Space of the offsets it uses |
| --- | --- | --- |
| various template codegen | `options.template` — the raw brace source, because that is what we publish | brace (ours) |
| `codegen/template/vFor.js` → `parseVForNode` | `node.loc.source` — the element's text as parsed from the *generated* markup | generated `loc.source`, remapped numbers |
| `interpolation.js`, directives | the expression's own text, laid out as one run | brace start + verbatim content |
| semantic tokens (language service) | creates a range by mapping **both ends** of a generated token | brace, via the plugin's mappings |

## Elements: Volar finds tags by searching the author's text

`@vue/language-core/lib/utils/shared.js`:

```js
function getElementTagOffsets(node, template) {
  const tagOffsets = [template.content.indexOf(node.tag, node.loc.start.offset)]
```

That assumes the AST describes the same text the author wrote. **Every synthesised element
fails it**: `@for` → `<template v-for=…>`, `@if` / `@empty` → `<template v-if=…>`, `@try` →
`<BraceTry>` plus `<template #default|#catch|#pending>`. The search returns **-1** — measured
at 15 of 45 elements in the demo — and Volar then derives positions from -1. It is a plain
substring match, so a slightly wrong offset finds the right word *inside* another one
(`li` matches inside `class="list"`).

Consequence: synthesised scaffolding produces stray semantic tokens, while copied markup
resolves exactly. No choice of offsets fixes the search itself — it searches the author's file.

**`alignElementStartsToTagNames`.** The component-name token provider in the language service
computes `start = element.loc.start.offset`, adds 1 **only when `template.lang === 'html'`**,
and then emits `length = element.tag.length`. Our brace AST follows the html convention (its
element starts sit on `<`), and our embedded `lang` is `brace`, so the provider adds nothing
and the token would run from the `<`. Shifting every element's start to its tag name
compensates. It is safe precisely because of the `indexOf` above: searching from the name
finds the same absolute offset. Pinned by the plugin test that replicates the provider's
arithmetic.

## `@for`: the one place with an inherent collision

`parseVForNode` rebuilds the binding pattern by slicing the element's own text:

```js
const leftExpressionRange = { start: value.loc.start.offset, end: (index ?? key ?? value).loc.end.offset }
const leftExpressionText = node.loc.source.slice(
  leftExpressionRange.start - node.loc.start.offset,
  leftExpressionRange.end - node.loc.start.offset,
)
```

`loc.source` is generated text, read with remapped (brace) numbers — one pass cannot satisfy
both. Reading the names with remapped offsets silently produced `"(it"` instead of `"item"`.

The working approach, in `collectVForPatterns` + `alignVForPatterns`:

1. read each binding name's text with **generated** deltas, *before* the AST is remapped;
2. anchor the synthetic `v-for` element on the `@for` column the author wrote;
3. rebuild `loc.source` as a padded pattern occupying the author's own columns
   (`item,` + spaces + `i`), so the slice is a valid pattern *and* maps 1:1.

Then `item`, `index` and the list each land on the word that was typed. Verified line for line
against the installed `codegen/template/vFor.js`, and pinned by a plugin test that replicates
the arithmetic — the only way to check it without a language server.

**Do not "fix" it by moving the element's start onto the generated geometry.** That makes the
slice come out right and corrupts every other consumer of that offset, which reads it as a
*source* position.

## Expressions: one run, from the expression's start

An interpolation or directive expression is mapped as a single run: N generated characters
laid out 1:1 from `exp.loc.start.offset`. Two requirements follow, and satisfying the first
hides the second:

1. the expression's **content** must be character-for-character what the author wrote
   (length equality is the point); and
2. its **start** must be a real source position — which means any synthesised *delimiter*
   needs an explicit anchor.

`@catch (e, retry)` → `#catch="[e, retry]"` satisfies both: the list is copied verbatim and
the brackets are anchored on the author's parentheses, giving segments at columns 11 (`[`→`(`),
12 (the list) and 20 (`]`→`)`) for `  } @catch (e, retry) {`. An earlier version aliased the
params (`{ error: e, reset: retry }`) — ten characters longer, so every token in the expression
drifted onto the markup after it and the bindings came back as `any`.

**The symptom to recognise:** types *and* token colours are right, but hover and
go-to-definition on the declaration site find nothing. That means the expression's *start* is
wrong, not the names: with the `[` unmapped the mapper parked the expression at the end of the
line and every name resolved past it. Check with a deliberately invalid member access
(`e.toFixed(1)` reports `on type 'Error'`) before concluding the type is missing.

Related: a **directive's value stays an unparsed string** in the AST, so a walk that collects
nodes with `content` finds no identifiers inside it; only interpolations are compounds. And
`#catch` is a slot *directive* — `{ name: 'slot', arg: { content: 'catch' } }` — not a prop
named `catch`.

## Semantic tokens: a range maps both of its ends

Volar computes a token's range by mapping its start *and* end, so a run of N generated
characters anchored at source position *p* paints the N characters after *p* — and a token
straddling a jump in the mapping spans the whole range, even across lines. That is the
mechanism behind every "token on unrelated markup" report in this repository.

The mapper's fallback matters for the same reason: an unmapped offset resolves to the **end of
the nearest copied run**, or to the end of the source line when the line has no segments.
Deliberately not the start of the line, which is where the delimiter sits (`} @pending {`) —
tokens for scaffolding that has no source counterpart used to land on those keywords and
repaint them as blue `property`.

### `@empty`: how a synthesised expression was removed

`@empty` used to compile to `<template v-if="!<list>.length">`, synthesised in full and
containing two identifiers Volar highlights. It was the one construct no anchor could make
harmless: the mapper parked it at the end of the line and the residue landed on whatever
followed — the six-character `length` token painted the line *below* — and anchoring the pieces
individually only moved it, because Volar re-lays the whole expression from its own start.

The fix was to take the expression out of the template. `@empty` now compiles to
`<BraceEmpty :list="items">`: the list is copied verbatim and attributed to the line the author
wrote it on — the `@for` line, via the same cross-line `Segment.source` mechanism the `@switch`
scrutinee uses — so its characters map onto real characters and nothing synthesised is left for
Volar to highlight. Measured on the demo, the `@empty` line's only segment is
`{ gen: 36, src: 20, length: 5, source: 20 }`.

The emptiness test itself lives in `BraceEmpty` (`list == null || list.length === 0`), which is
also stricter than the template form was: `!undefined.length` threw.

## The editor stack, for reference

* **The language server cannot produce template semantic tokens outside VS Code.** It sends
  `tsserver/request` to its client and waits for `tsserver/response`, which only the built-in
  TypeScript extension answers; nothing answers a scripted client, so
  `textDocument/semanticTokens/full` never resolves — no error, no log. Token work is therefore
  verified with scope dumps and plugin-level assertions instead.
* **`vue-tsc` cannot run under Deno.** Volar registers the `.vue` extension by patching
  `fs.readFileSync` so it can rewrite `tsc.js`; Deno's CommonJS loader never routes module loads
  through it, so TypeScript loads unpatched and `.vue` files are simply absent from the program,
  silently. Type checking in this repo goes through `tsc` (`deno task check:types`) and the
  plugin's own tests.
* **Highlighting is a grammar-injection problem, not a language registration.** See
  `packages/vscode-vue-brace/README.md`, which is the canonical write-up: the block rule is injected
  into Volar's `text.html.vue`, `vue.directives` is re-injected into `text.html.brace`, and the
  brace grammar owns `{{ … }}` itself. Never include `text.html.vue` as a whole from a grammar
  injected into it — the cycle silently removes all markup scoping.
* **`patchErrors` is broken for any rewriting preprocessor**: it computes its line offset with
  `originalSource.indexOf(preprocessedSource)`, which is `-1` here, so template *error* line
  numbers are shifted by a bogus amount. Source *maps* are unaffected. Pug has the same problem.
  `compileBrace`'s own errors carry explicit line numbers because they are thrown from the
  preprocessor and reported verbatim.

## Harnesses

| Tool | What it answers |
| --- | --- |
| `deno run -A scripts/brace-synth.ts <file.vue> --text=<needle>` | for a needle in the *compiled* template: its generated offset, the segments of its line, where its characters map, and the text found there. This is what found the `@empty` residue. |
| `deno task scopes --cwd=packages/vscode-vue-brace [file] [--all] [--theme t.json]` | the TextMate scopes (and optionally colours) a brace template gets, through Vue.volar's real grammars. Needs the built-in `html`/`typescript` grammars in `$BRACE_GRAMMARS` for a full picture. |
| `deno task build:plugin` | builds the CommonJS `dist` the editor loads. Must run before `deno task test` (there is a freshness test), and before a **window reload** is worth anything. |

Two Node-only harnesses (`volar-raw.mjs`, `volar-tsx.mjs`) were used during the campaign and
removed: they drive `@vue/language-core`'s codegen directly, which is useful, but they cannot
run here (no Node on `PATH`) and the plugin-level tests now replicate their arithmetic. Rebuild
them from the git history if a mapping bug needs that level of inspection.
