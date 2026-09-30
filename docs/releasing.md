# Releasing

`docs/distribution.md` covers the channels (a registry, and why git installs are not set up).
This is the checklist for cutting a version.

## What ships

| Package | Registry | Built by | Contents |
| --- | --- | --- | --- |
| `@cockernutx/brace-template` | npm | `deno task build:plugin` (two `tsc` projects) | `dist/` — CommonJS for Node consumers — and `dist/esm/` for bundlers and Deno, each with declarations |
| `@cockernutx/language-plugin-brace` | npm | the same task | `dist/` (CommonJS: the entry Volar `require()`s) plus the `index.cjs` shim |
| `vscode-vue-brace` | VS Code Marketplace | nothing — it is grammar files and a manifest | `syntaxes/`, `language-configuration.json` |

The extension ships an *allow-list* — the `files` field in its manifest — rather than a
`.vscodeignore`: vsce rejects the two together, and an allow-list cannot leak the test fixtures,
the scope harness or a stray `.vsix` from an earlier package. `deno task check:pack` fails if a
`.vscodeignore` ever reappears beside a `files` field.

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
   `@cockernutx/brace-template` range in step with it.
6. For the editor extension, `npx vsce package` / `vsce publish` — that needs Node and a publisher
   account, neither of which exists in this container, so it runs on the host.

## Continuous integration

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, pull requests | `deno install --frozen`, lint (and fails if the linter had to change anything), `deno task test`, `deno task build` |
| `release.yml` | `v*` tag, or manual dispatch | checks the tag against every manifest, tests, then publishes both packages to `vars.NPM_REGISTRY` with `secrets.NPM_TOKEN` |
| `extension.yml` | `v*` tag, or manual dispatch | packages the extension with `vsce`, uploads the `.vsix`, and publishes it via trusted publishing — no PAT stored |

## Repository settings

Everything the workflows read has to exist in the repository, not in the code. Click-paths are for
GitHub's UI; the values are the ones this repository expects.

| Setting | Where | Value |
| --- | --- | --- |
| `NPM_REGISTRY` | Settings → Secrets and variables → Actions → **Variables** → New repository variable | `https://registry.npmjs.org` (the website, `www.npmjs.com`, is not a publish target) |
| `NPM_TOKEN` | same page → **Secrets** → New repository secret | an npm **automation** token (npmjs.com → Access Tokens → Generate new token → Automation). Automation tokens skip the OTP prompt, which a release job cannot answer |
| npm scope | — | nothing to create: `@cockernutx` is the publishing account's username, so npm gives it that scope automatically. An org named instead would have to be created and the packages renamed into it. |
| Marketplace publisher | marketplace.visualstudio.com → Manage publishers | a publisher named `vue-brace`, matching `publisher` in the extension manifest |
| Trusted publishing | that publisher → Trusted Publishing | repository `strawberyy-coconut/vue-brace`, workflow `extension.yml`. This is what `vsce publish --oidc` exchanges for a session token, so no PAT is stored |
| Workflow permissions | Settings → Actions → General | "Read repository contents" is enough: each workflow declares the permissions it needs, and only the extension publish asks for `id-token: write` |
| Environment `release` | Settings → Environments | created automatically on first release. Optional: add required reviewers to gate publishing, and move `NPM_TOKEN` here from repository secrets to scope it to releases (leave the variable where it is, or add it here too) |
| Tag protection | Settings → Tags → New rule: `v*` | the tag *is* the publish trigger, so restrict who can create one |
| Branch rules | Settings → Rules → New branch ruleset | require the `test` check on `master`, so red CI cannot be merged or tagged |

Two things stay outside GitHub: the npm scope and the Marketplace publisher. Both belong to an
account, not to this repository, and both have to exist before the first release.

CI itself needs nothing: `ci.yml` runs with no secrets at all.

Two honest gaps in the CI picture: the `vscode-vue-brace` suite **skips three tests on a runner** (they
tokenise Vue.volar's real grammars, which are not installed there — they run in the dev container),
and nothing is tested on macOS or Windows, because every environment this project supports so far
is the Linux dev container.

Cutting a release is then: bump the version in every manifest, commit, `git tag v0.1.1`, push the
tag. `scripts/check-tag.ts` refuses the run if the tag and the manifests disagree.

## Still to fill in before the first publish

- **Ownership.** `@cockernutx` is the account's own username scope, so npm needs nothing created;
  the Marketplace publisher `cockernutx` has to be claimed on the Marketplace (Manage publishers)
  before the first extension publish. `publisher` is already set in the extension manifest, and
  `repository` / `homepage` / `bugs` are filled in (including the monorepo `directory`, so npm links
  to the right folder and `vsce` stops asking).
- **LICENSE holder.** The three `LICENSE` files say "vue-brace contributors". Put a real name or
  organisation there if the licence should name one.

## Notes

- After `deno task build:plugin`, reload the window before judging editor behaviour: the language
  server and the grammar are both loaded per window.
- JSR is an alternative to npm that publishes TypeScript directly, which would let `exports` point
  at `src/` again and drop the ESM build entirely. It is not configured here.
