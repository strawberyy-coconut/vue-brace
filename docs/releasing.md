# Releasing

`docs/distribution.md` covers the channels (a registry, and why git installs are not set up).
This is the checklist for cutting a version.

## What ships

| Package | Registry | Built by | Contents |
| --- | --- | --- | --- |
| `@vue-brace/brace-template` | npm | `deno task build:plugin` (two `tsc` projects) | `dist/` — CommonJS for Node consumers — and `dist/esm/` for bundlers and Deno, each with declarations |
| `@vue-brace/language-plugin-brace` | npm | the same task | `dist/` (CommonJS: the entry Volar `require()`s) plus the `index.cjs` shim |
| `vscode-vue-brace` | VS Code Marketplace | nothing — it is grammar files and a manifest | `syntaxes/`, `language-configuration.json` |

`files` in each manifest is the shipping set, and `exports` never points at TypeScript, so a
consumer cannot pull a `.ts` file into their build by accident. `dist/` is git-ignored: it is
regenerated, and every publish runs the build first.

## Checklist

1. `deno task test` — four suites plus the type-level checks. It builds first, so a green run also
   means the published artefacts compile.
2. `deno task lint`.
3. Check the package shape — every `exports` target present, nothing pointing at TypeScript, and a
   licence and README in the shipping set: `deno task check:pack` (part of `deno task test`).
4. Publish: `deno task release --local` against the repository's own registry to rehearse, then
   `deno task release --registry <url> --token "$TOKEN"` for real. It builds, packs, checks each
   tarball and refuses to replace an existing version — see `docs/distribution.md`.
4. Smoke-test as a consumer would: a scratch directory whose `package.json` depends on the packed
   tarball, `deno install`, then import the root entry and `require()` the plugin. The `require()`
   is the one that matters — a plugin that fails to load produces only a warning in the editor's
   output channel, and then every brace template is silently untyped.
5. Bump `version` in **every** package that ships, and keep the plugin's
   `@vue-brace/brace-template` range in step with it.
6. For the editor extension, `npx vsce package` / `vsce publish` — that needs Node and a publisher
   account, neither of which exists in this container, so it runs on the host.

## Continuous integration

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, pull requests | `deno install --frozen`, lint (and fails if the linter had to change anything), `deno task test`, `deno task build` |
| `release.yml` | `v*` tag, or manual dispatch | checks the tag against every manifest, tests, then publishes both packages to `vars.NPM_REGISTRY` with `secrets.NPM_TOKEN` |
| `extension.yml` | `v*` tag, or manual dispatch | packages the extension with `vsce`, uploads the `.vsix`, and publishes it via trusted publishing — no PAT stored |

Three things to set up once, in the repository settings:

- **Actions → General**: the variable `NPM_REGISTRY` (where `deno task release` publishes) and the
  secret `NPM_TOKEN` (its publish token; omit it for a registry that allows anonymous publish).
- **Marketplace**: a trusted publishing policy for this repository and `extension.yml`, which is
  what `vsce publish --oidc` exchanges `id-token: write` for. Without it the publish step fails.
- Nothing for CI itself. It needs no secrets.

Two honest gaps in the CI picture: the `vscode-vue-brace` suite **skips three tests on a runner** (they
tokenise Vue.volar's real grammars, which are not installed there — they run in the dev container),
and nothing is tested on macOS or Windows, because every environment this project supports so far
is the Linux dev container.

Cutting a release is then: bump the version in every manifest, commit, `git tag v0.1.1`, push the
tag. `scripts/check-tag.ts` refuses the run if the tag and the manifests disagree.

## Still to fill in before the first publish

- **Ownership.** The `@vue-brace` npm scope and the `vue-brace` Marketplace publisher have to
  exist and belong to whoever publishes. `publisher` is already set in the extension manifest, and
  `repository` / `homepage` / `bugs` are filled in (including the monorepo `directory`, so npm links
  to the right folder and `vsce` stops asking).
- **LICENSE holder.** The three `LICENSE` files say "vue-brace contributors". Put a real name or
  organisation there if the licence should name one.

## Notes

- After `deno task build:plugin`, reload the window before judging editor behaviour: the language
  server and the grammar are both loaded per window.
- JSR is an alternative to npm that publishes TypeScript directly, which would let `exports` point
  at `src/` again and drop the ESM build entirely. It is not configured here.
