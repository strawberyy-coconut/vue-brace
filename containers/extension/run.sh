#!/bin/sh
# The extension: package the `.vsix` you upload to the Marketplace.
#
# Runs inside containers/extension/Containerfile. Node builds the archive, Deno runs the
# package's own `build` task.
set -eu
cd "$(dirname "$0")/../.."

# The tag is the one version written by hand rather than read from a manifest, so a mistyped tag
# must not produce a release whose file claims a different version.
if [ -n "${RELEASE_TAG:-}" ]; then
  version="$(node -p "require('./packages/vscode-vue-brace/package.json').version")"
  expected="${RELEASE_TAG#v}"
  if [ "$version" != "$expected" ]; then
    echo "vscode-vue-brace: version is $version, tag says $expected" >&2
    exit 1
  fi
fi

deno task --cwd=packages/vscode-vue-brace build

mkdir -p /out
cp packages/vscode-vue-brace/vscode-vue-brace.vsix /out/
