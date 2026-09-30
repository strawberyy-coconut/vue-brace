#!/bin/sh
# The release: build, test, check the tarballs, then publish with npm.
#
# Runs inside containers/release/Containerfile, which is the deno image plus Node — `npm publish`
# is the publisher, so there is no hand-rolled registry client to maintain.
set -eu
cd "$(dirname "$0")/../.."

registry="${NPM_REGISTRY:-https://registry.npmjs.org}"

# npm takes its token from `.npmrc`, keyed by registry host — there is no NPM_TOKEN variable it
# reads directly. Skipped when there is no token, which is what an open registry wants.
if [ -n "${NPM_TOKEN:-}" ]; then
  host="$(printf '%s' "$registry" | sed -e 's#^[a-z][a-z]*://##' -e 's#/.*$##')"
  printf '//%s/:_authToken=%s\n' "$host" "$NPM_TOKEN" >>"$HOME/.npmrc"
fi

# `--frozen` so the published packages come from the lockfile this commit pins.
deno install --frozen

# Builds the packages and runs the suites. `npm publish` ships the built `dist/`, and the
# packages deliberately have no `prepack` that would rebuild it — so this has to come first.
deno task test

# What npm is about to upload, checked for the failures npm does not catch.
deno run -A containers/release/pack.ts

dry=
if [ "${DRY_RUN:-false}" = "true" ]; then dry=--dry-run; fi

for dir in packages/brace-template packages/language-plugin-brace; do
  echo "publishing $dir"
  (cd "$dir" && npm publish --registry "$registry" --access public $dry)
done
