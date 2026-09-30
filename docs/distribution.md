# Distribution

Two channels. The registry one is the supported path; the git one has a hard limitation worth
knowing before someone tries it.

## Deploy to a registry

```sh
deno task registry         # terminal 1 — the registry this repository ships, on :4873
deno task release --local  # terminal 2 — build, pack and publish both packages there
```

`deno task release` builds both packages first, packs them as npm tarballs (fixed mtime and sorted
entries, so the same source gives the same bytes and therefore the same integrity), and checks
each tarball *before* uploading:

- every `exports` target is present in it,
- no `src/` file is in it,
- the version does not already exist on the target registry.

Then it puts the packument and the attachment, exactly as `npm publish` does — so any registry that
speaks the npm API works:

```sh
deno task release --registry https://registry.npmjs.org --token "$NPM_TOKEN"   # the official one
deno task release --registry https://npm.pkg.github.com --token "$NPM_TOKEN"
deno task release --registry https://gitlab.com/api/v4/projects/<id>/packages/npm/ --token "$TOKEN"
deno task release --local --dry-run      # pack and verify, publish nothing
deno task release --local --tag next     # dist-tag other than `latest`
```

`NPM_REGISTRY` in the release workflow is exactly this string, so for the official registry set the
repository variable to `https://registry.npmjs.org`. Note that `https://www.npmjs.com` is the
*website*, not a publish target — pointing a release at it fails in a way that reads like a network
problem rather than a wrong URL.

### The official registry

Two npm-specific details are handled by the toolchain, because both are silent traps:

- **Scoped names are percent-encoded in registry paths**: `@vue-brace/brace-template` is requested as
  `@vue-brace%2fbrace-template`. That is what npm sends, and the official registry routes the
  encoded form to publish and the unencoded form to a version lookup. Tarball URLs *inside* the
  packument keep the slash, as every real packument does.
- **`access: public` is sent** in the publish body. A scoped package published without it defaults to
  *private*, which on a free plan fails with a 402 — a confusing way to learn the field exists.
  `--access restricted` overrides it.

What still has to be true outside this repository:

- The account or organisation publishing must **own the `@vue-brace` scope** (or the packages have to
  be renamed to a scope it owns).
- `secrets.NPM_TOKEN` must be an automation token, or a granular token with publish rights for that
  scope. Two-factor publishing settings on the account apply to it as well.
- `repository`, `homepage` and `bugs` in the manifests are what npm links from the package page;
  they are deliberately unset until this repository has a remote (see `docs/releasing.md`).

Consumers of the official registry need no `.npmrc` at all — it is the default. The `.npmrc` line
below is for the *other* registries.

A consumer points the scope at it — one line of `.npmrc` — and then installs by name and version,
which is what their lockfile wants anyway:

```ini
@vue-brace:registry=http://127.0.0.1:4873/
```

`files` in each manifest decides what ships; `prepack` rebuilds, so a hand-run `npm publish` cannot
ship a stale `dist/`; and `deno task check:pack` fails the test suite if `exports` ever points at
something that will not be in the tarball.

### The registry in this repository

`deno task registry` (`scripts/registry.ts`) is a small npm registry that runs on Deno — no
account, no Node, no container:

| Endpoint | Purpose |
| --- | --- |
| `GET /:name` | the packument — versions, dist-tags, tarball URLs, integrity |
| `GET /:name/-/:file.tgz` | a tarball |
| `PUT /:name` | publish |
| `GET /-/ping`, `GET /-/whoami` | what npm probes at startup and for `npm login` |

Tarballs and packuments live in `.registry/` (git-ignored). Set `NPM_TOKEN` to require a bearer
token, `PORT` to move it. It publishes, resolves and installs; it does not do yanking, audit
endpoints, dist-tag manipulation beyond keeping `latest` on the newest publish, or any access
control beyond that token. For anything shared beyond a team, use Verdaccio or your host's
registry — the release toolchain does not care which.

## Git installs — and why they are not set up here

`npm install github:owner/repo` clones the repository and expects a package at its **root**. npm's
git spec is `<protocol>://…[/]<path>[#<commit-ish> | #semver:<semver>]`: there is a commit-ish but
**no path component**, and `npm-package-arg` parses `gitRange`, `gitCommittish` and `hosted` but no
subdirectory. So npm cannot install a package from a subdirectory of a git repository, and both
packages here live under `packages/`.

What that leaves, for anyone who wants a git install rather than a registry:

- **pnpm** and **yarn** do support subdirectories (`#path:packages/brace-template`,
  `#workspace=…`). A clone contains `src/` only, because `dist/` is git-ignored, so they would also
  need the package to build on install — this repository deliberately has no `prepare` script,
  because a `prepare` that cannot run (`--omit=dev`, `--ignore-scripts`) fails the whole install
  rather than falling back.
- **npm** would need the package at the root of a ref: a `git subtree split` branch per package, or
  a mirror repository per package, with a build committed on the branch. That is a second artefact
  to keep in sync, and it is exactly what the registry channel replaces.
- **Committing `dist/`** would make any git clone installable with no toolchain at all, at the cost
  of build output in every diff and a staleness risk that needs its own test. Not done, for the same
  reason: the registry carries the build instead.

If git installs are needed later, the smallest honest version is a `git subtree split` branch per
package, created after `deno task build:plugin` and force-updated on each release; consumers pin a
commit through their lockfile, since a branch ref alone is mutable.
