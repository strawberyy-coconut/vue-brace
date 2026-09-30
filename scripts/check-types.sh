#!/bin/sh
# Type-level checks, run with `tsc` from the workspace root.
#
# Kept out of `deno check` on purpose: Deno's checker does not honour Vue's `SlotsType`
# (`unique symbol`-branded), so these assertions fail there for the wrong reason. `tsc` is also
# what Volar uses, so it is the checker worth trusting for anything Volar reads.
#
# `allowImportingTsExtensions` because the packages' own sources import each other Deno-style
# (`./BraceEmpty.ts`), and this program now reaches them through `BraceTry.ts`. It is only legal
# alongside `--noEmit`, which is what this script does anyway.
set -e
cd "$(dirname "$0")/.."
exec deno run -A npm:typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --allowImportingTsExtensions \
  --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
  packages/brace-template/type-tests/brace-try.ts
