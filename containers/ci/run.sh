#!/bin/sh
# The CI workflow. Every step the repository is checked with, in the order that fails fastest.
#
# This is a shell script rather than a list of steps in YAML so the same thing can be run
# locally (`docker build -f containers/ci/Containerfile .`) and so a failure is read as output
# rather than interpreted from a workflow log.
set -eu
cd "$(dirname "$0")/../.."

# `--frozen` fails when `deno.lock` is out of date, which is the point: a green build from a
# lockfile nobody updated is worse than a red one.
deno install --frozen

deno task lint
deno task check:types
# Builds the packages, runs all four suites and builds the playground.
deno task test
# Last because it is the only step that needs Node, and the slowest.
deno task type-check
